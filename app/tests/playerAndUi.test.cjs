const { suite } = require('./register-ts.cjs')

suite('Floating player policy', test => {
  const assert = require('node:assert/strict'), Module = require('node:module'), { EventEmitter } = require('node:events')
  const originalLoad = Module._load, external = []
  Module._load = function (name, ...args) {
    if (name === 'electron') return { screen: { getDisplayMatching: () => ({ workArea: { x: 100, y: 100, width: 1200, height: 800 } }) }, shell: { openExternal: async url => { external.push(url) } } }
    return originalLoad.call(this, name, ...args)
  }
  const { installFloatingPlayerWindow } = require('../Back-End/electron/floatingPlayer.ts')
  Module._load = originalLoad

  test('floating window policy permits one trusted surface, blocks navigation and restores background throttling', () => {
    const owner = { getBounds: () => ({}), webContents: new EventEmitter() }, content = owner.webContents
    let handler, childHandler, throttled = true, menu
    Object.assign(content, { setWindowOpenHandler: value => { handler = value }, getBackgroundThrottling: () => throttled, setBackgroundThrottling: value => { throttled = value }, isDestroyed: () => false })
    installFloatingPlayerWindow(owner)
    const request = { url: 'about:blank', frameName: 'cortex-floating-player' }
    const result = handler(request)
    assert.equal(result.action, 'allow'); assert.equal(result.overrideBrowserWindowOptions.alwaysOnTop, true)
    assert.equal(result.overrideBrowserWindowOptions.frame, false, 'Floating player must use one integrated header')
    assert.equal(result.overrideBrowserWindowOptions.webPreferences, undefined, 'About-blank window must inherit the protected renderer preferences')
    assert.equal(handler({ ...request, frameName: 'other' }).action, 'deny')
    assert.equal(handler({ ...request, url: 'file:///private.txt' }).action, 'deny')
    assert.equal(handler({ ...request, url: 'https://example.test/' }).action, 'deny'); assert.deepEqual(external, ['https://example.test/'])
    const child = new EventEmitter(); child.webContents = new EventEmitter(); child.setMenu = value => { menu = value }
    child.webContents.setWindowOpenHandler = value => { childHandler = value }
    content.emit('did-create-window', child, { frameName: request.frameName })
    assert.equal(menu, null); assert.equal(throttled, false); assert.equal(handler(request).action, 'deny'); assert.equal(childHandler(request).action, 'deny')
    for (const name of ['will-navigate', 'will-redirect']) { let prevented = false; child.webContents.emit(name, { preventDefault: () => { prevented = true } }); assert.equal(prevented, true) }
    child.emit('closed'); assert.equal(throttled, true); assert.equal(handler(request).action, 'allow')
  })
})

suite('Floating playback', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn, execFileSync } = require('node:child_process')
  const http = require('node:http')

  test('floating player preserves real playback and Arabic cues, frees downloads, restores and releases native windows', { timeout: 55000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-floating-player-'))
    let server
    try {
      execFileSync(path.resolve(__dirname, '../engine-baseline/ffmpeg.exe'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=30', '-f', 'lavfi', '-i', 'sine=duration=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-movflags', '+faststart', path.join(directory, 'video.mp4')], { windowsHide: true, timeout: 15000 })
      const media = await fs.readFile(path.join(directory, 'video.mp4'))
      execFileSync(path.resolve(__dirname, '../engine-baseline/ffmpeg.exe'), ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(directory, 'video.mp4'), '-vn', '-c:a', 'libmp3lame', path.join(directory, 'audio.mp3')], { windowsHide: true, timeout: 15000 })
      const audio = await fs.readFile(path.join(directory, 'audio.mp3'))
      server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        const name = new URL(req.url, 'http://localhost').searchParams.get('path')
        if (name !== 'video.mp4' && name !== 'audio.mp3') {
          res.setHeader('Content-Type', 'text/vtt')
          res.end(`WEBVTT\n\n00:00:00.000 --> 00:00:29.000\n${name === 'ar.vtt' ? 'ترجمة عربية في النافذة العائمة' : 'English floating subtitles'}\n`)
          return
        }
        const data = name === 'audio.mp3' ? audio : media
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || ''), start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1
        res.setHeader('Content-Type', name === 'audio.mp3' ? 'audio/mpeg' : 'video/mp4'); res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Length', end - start + 1)
        if (match) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`) }
        res.end(data.subarray(start, end + 1))
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const esbuild = require('esbuild')
      esbuild.buildSync({ entryPoints: [path.join(__dirname, 'fixtures/floatingPlayer.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"', __MEDIA_PORT__: String(server.address().port) } })
      esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../Back-End/electron/floatingPlayer.ts')], bundle: true, platform: 'node', external: ['electron'], format: 'cjs', outfile: path.join(directory, 'policy.cjs') })
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body style="margin:0;background:#0b1424;color:white;font-family:Arial"><div id="root"></div><script src="renderer.js"></script></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
        app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
        const delay=ms=>new Promise(r=>setTimeout(r,ms));
        app.whenReady().then(async()=>{
          const win=new BrowserWindow({show:false,width:1050,height:720,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
          require('./policy.cjs').installFloatingPlayerWindow(win);
          const js=s=>win.webContents.executeJavaScript(s),wait=async(s)=>{for(let n=0;n<100;n++){if(await js(s))return;await delay(40)}throw Error('Main did not settle: '+s)};
          await win.loadFile(path.join(__dirname,'index.html'));console.log('loaded');
          await wait('document.querySelector("video")?.readyState>=2');await js('window.fixture.remember();window.fixture.video().currentTime=3;window.fixture.video().play()');
          assert.equal(await js('document.querySelectorAll(".player-header .media-info-toggle").length'),1);
          assert.equal(await js('document.querySelectorAll(".player-header .media-player-close").length'),1);
          assert.equal(await js('document.querySelectorAll(".player-footer .floating-player-actions").length'),0);
          assert.notEqual(await js('getComputedStyle(document.querySelector("video")).getPropertyValue("-webkit-app-region")'),'drag');
          await wait('window.fixture.video().textTracks[0]?.activeCues?.[0]?.text.includes("عربية")');
          const before=await js('window.fixture.video().currentTime');console.log('playing with cues');
          await wait('!!document.querySelector(".player-artwork-trigger")');
          await js('document.querySelector(".player-artwork-trigger").click()');await wait('document.querySelector(".player-artwork-change") && !document.querySelector(".player-artwork-change").disabled');
          await js('document.querySelector(".player-artwork-change").click()');
          await wait('!!document.querySelector(".player-artwork-saving [role=progressbar]")');
          await wait('document.querySelector(".player-artwork-remove") && window.fixture.video().currentTime>=3 && !window.fixture.video().paused');
          if(process.env.CORTEX_FLOATING_CAPTURE){await delay(200);fs.writeFileSync(path.join(process.env.CORTEX_FLOATING_CAPTURE,'video-cover-menu.png'),(await win.webContents.capturePage()).toPNG());}
          assert.equal(await js('window.fixture.video()===document.querySelector("video")'),true,'Cover edit must retain the media element');
          assert.equal(await js('window.fixture.video().textTracks[0].mode'),'showing');
          // Off is a selection too: delayed discovery must not re-enable captions.
          await js('document.querySelector(".player-artwork-trigger").click();document.querySelector(".subtitle-trigger").click()');
          await wait('!!document.querySelector(".subtitle-menu")');
          await js('document.querySelectorAll(".subtitle-option")[0].click()');
          await wait('Array.from(window.fixture.video().textTracks).every(track=>track.mode==="disabled")');
          await js('document.querySelector(".player-artwork-trigger").click()');
          await wait('document.querySelector(".player-artwork-remove") && !document.querySelector(".player-artwork-remove").disabled');
          await js('document.querySelector(".player-artwork-remove").click()');
          await wait('!document.querySelector(".player-artwork-remove") && window.fixture.video().readyState>=2 && !window.fixture.video().paused');
          await delay(400);
          assert.equal(await js('Array.from(window.fixture.video().textTracks).every(track=>track.mode==="disabled")'),true,'Cover removal must preserve subtitles Off after delayed discovery');
          await wait('!document.querySelector(".player-artwork-change").disabled');
          await js('document.querySelector(".player-artwork-change").click()');
          await wait('document.querySelector(".player-artwork-remove") && window.fixture.video().readyState>=2 && !window.fixture.video().paused');
          await delay(400);
          assert.equal(await js('Array.from(window.fixture.video().textTracks).every(track=>track.mode==="disabled")'),true,'Cover change must preserve subtitles Off after delayed discovery');
          await js('document.querySelector(".player-artwork-trigger").click();document.querySelector(".subtitle-trigger").click()');
          await wait('!!document.querySelector(".subtitle-menu")');
          await js('document.querySelectorAll(".subtitle-option")[1].click()');
          await wait('window.fixture.video().textTracks[0]?.activeCues?.[0]?.text.includes("عربية")');
          await js('document.querySelector(".player-floating-toggle").click()');await wait('window.fixture.result().floating');
          const child=BrowserWindow.getAllWindows().find(w=>w!==win);assert.ok(child);assert.equal(child.isAlwaysOnTop(),true);console.log('floating');
          const childJs=s=>child.webContents.executeJavaScript(s),childWait=async s=>{for(let n=0;n<100;n++){if(await childJs(s))return;await delay(40)}throw Error('Floating did not settle: '+s)};
          await childWait('document.querySelector("video")?.readyState>=2');
          assert.equal(await childJs('document.querySelectorAll(".player-header").length'),0);
          assert.equal(await childJs('document.querySelectorAll(".player-footer .media-info-toggle").length'),1);
          assert.equal(await childJs('document.querySelectorAll(".player-footer .media-player-close").length'),1);
          assert.equal(await childJs('getComputedStyle(document.querySelector(".floating-player-drag-handle")).getPropertyValue("-webkit-app-region")'),'drag');
          for(const selector of ['.player-body','.video-wrapper','video','.player-footer']) {
            assert.equal(await childJs('getComputedStyle(document.querySelector('+JSON.stringify(selector)+')).getPropertyValue("-webkit-app-region")'),'drag',selector+' must allow moving the window');
          }
          for(const selector of ['.play-btn','.progress-slider','.volume-slider','.subtitle-trigger','.media-info-toggle','.media-player-close']) {
            assert.equal(await childJs('getComputedStyle(document.querySelector('+JSON.stringify(selector)+')).getPropertyValue("-webkit-app-region")'),'no-drag',selector+' must remain interactive');
          }
          await childJs('document.querySelector("video").click()');
          assert.equal(await childJs('document.querySelector("video").paused'),false,'Grabbing the floating video must not pause playback');
          assert.equal(await childJs('getComputedStyle(document.querySelector(".player-footer")).backgroundColor'),'rgb(0, 0, 0)');
          assert.notEqual(await childJs('getComputedStyle(document.querySelector(".volume-slider")).display'),'none');
          await childJs('(()=>{const input=document.querySelector(".volume-slider");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"0.35");input.dispatchEvent(new Event("input",{bubbles:true}))})()');
          await childWait('Math.abs(document.querySelector("video").volume-0.35)<0.01');
          await childJs('document.querySelector(".volume-group button").click()');await childWait('document.querySelector("video").volume===0');
          await childJs('document.querySelector(".volume-group button").click()');await childWait('Math.abs(document.querySelector("video").volume-0.35)<0.01');
          await childJs('document.querySelector(".media-info-toggle").click()');await childWait('!!document.querySelector(".media-info-panel")');
          assert.equal(await childJs('getComputedStyle(document.querySelector(".media-info-panel")).getPropertyValue("-webkit-app-region")'),'no-drag');
          const infoBounds=await childJs('(()=>{const r=document.querySelector(".media-info-panel").getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,left:r.left,width:innerWidth,footer:document.querySelector(".player-footer").getBoundingClientRect().top}})()');
          assert.ok(infoBounds.top>=0&&infoBounds.left>=0&&infoBounds.right<=infoBounds.width&&infoBounds.bottom<infoBounds.footer,JSON.stringify(infoBounds));
          await childJs('document.querySelector(".media-info-close").click()');
          if(process.env.CORTEX_FLOATING_CAPTURE){await delay(200);fs.writeFileSync(path.join(process.env.CORTEX_FLOATING_CAPTURE,'floating-player-wide.png'),(await child.webContents.capturePage()).toPNG());}
          assert.equal(await js('window.fixture.video().ownerDocument===document'),false);
          assert.equal(await js('!!document.querySelector(".media-player-overlay")'),false);
          assert.equal(await childJs('window.opener.fixture.video()===document.querySelector("video")'),true,'Floating must preserve the original video node');
          await delay(500);assert.ok(await childJs('document.querySelector("video").currentTime')>before,'Floating playback must continue');
          assert.equal(await childJs('document.querySelector("video").textTracks[0].mode'),'showing');
          assert.match(await childJs('document.querySelector("video").textTracks[0].activeCues[0].text'),/عربية/);
          await js('document.querySelector("#download-url").value="https://example.test/video";document.querySelector("#download-url").dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true}));document.querySelector("#new-download").click()');
          assert.equal(await js('window.fixture.result().downloads'),1);assert.equal(await childJs('document.querySelector("video").paused'),false,'Main window typing must not pause floating playback');
          await childJs('document.querySelector(".subtitle-trigger").click()');await childWait('!!document.querySelector(".subtitle-menu")');
          await childJs('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}));document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
          await childWait('document.querySelector("video").textTracks[1].mode==="showing"');
          await childWait('document.querySelector("video").textTracks[1].activeCues?.[0]?.text.includes("English")');
          const coverPosition=await childJs('document.querySelector("video").currentTime');
          await childJs('document.querySelector(".player-artwork-trigger").click()');await childWait('document.querySelector(".player-artwork-remove") && !document.querySelector(".player-artwork-remove").disabled');
          await childJs('document.querySelector(".player-artwork-remove").click()');
          await childWait('!document.querySelector(".player-artwork-remove") && document.querySelector("video").readyState>=2 && !document.querySelector("video").paused');
          assert.ok(await childJs('document.querySelector("video").currentTime')>=coverPosition-.1);
          assert.equal(await childJs('document.querySelector("video").textTracks[1].mode'),'showing','Editing must preserve selected subtitles');
          await childWait('document.querySelector("video").textTracks[1].activeCues?.[0]?.text.includes("English")');
          assert.equal(await childJs('Array.from(document.querySelector("video").textTracks).filter(track=>track.mode==="showing").length'),1,'Only the selected subtitle track should be showing after editing');
          await childJs('document.querySelector(".player-artwork-trigger").click()');
          await childJs('document.querySelector(".subtitle-trigger").click()');await childWait('!!document.querySelector(".subtitle-menu")');
          await childJs('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
          await childWait('!document.querySelector(".subtitle-menu")');assert.equal(child.isDestroyed(),false,'Menu Escape must not close the player');
          await childJs('document.querySelector(".subtitle-trigger").click()');await childWait('!!document.querySelector(".subtitle-menu")');
          await childJs('document.querySelectorAll(".subtitle-option")[1].click()');await childWait('document.querySelector("video").textTracks[0].mode==="showing"');
          await childWait('document.querySelector("video").textTracks[0].activeCues?.[0]?.text.includes("عربية")');
          await delay(100);
          assert.equal(await childJs('Array.from(document.querySelector("video").textTracks).filter(track=>track.mode==="showing").length'),1,'Selecting Arabic must disable English');
          child.setSize(380,280);await delay(150);
          await childJs('document.querySelector(".player-artwork-trigger").click()');await childWait('!!document.querySelector(".player-artwork-menu")');
          const coverBounds=await childJs('(()=>{const r=document.querySelector(".player-artwork-menu").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
          assert.ok(coverBounds.left>=0&&coverBounds.right<=coverBounds.width&&coverBounds.top>=0&&coverBounds.bottom<=coverBounds.height,JSON.stringify(coverBounds));
          if(process.env.CORTEX_FLOATING_CAPTURE){await delay(200);fs.writeFileSync(path.join(process.env.CORTEX_FLOATING_CAPTURE,'floating-cover-menu-narrow.png'),(await child.webContents.capturePage()).toPNG());}
          assert.equal(await childJs('getComputedStyle(document.querySelector(".player-artwork-menu")).getPropertyValue("-webkit-app-region")'),'no-drag');
          await childJs('document.querySelector(".player-artwork-trigger").click()');
          const bounds=await childJs('(()=>{const r=document.querySelector(".player-footer").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:innerWidth,scroll:document.documentElement.scrollWidth}})()');assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0,JSON.stringify(bounds));assert.equal(bounds.scroll,bounds.width);
          if(process.env.CORTEX_FLOATING_CAPTURE){await childJs('document.querySelector(".media-player-container").dispatchEvent(new MouseEvent("mousemove",{bubbles:true}))');await delay(300);fs.writeFileSync(path.join(process.env.CORTEX_FLOATING_CAPTURE,'floating-player-ar.png'),(await child.webContents.capturePage()).toPNG());}
          const position=await childJs('document.querySelector("video").currentTime');console.log('closing native');child.close();
          await wait('!window.fixture.result().floating && !!document.querySelector("video")');
          await wait('window.fixture.video().readyState>=2 && !window.fixture.video().paused && window.fixture.video().currentTime>='+Math.max(0,position-0.2));
          assert.equal(await js('window.fixture.video()===document.querySelector("video")'),true);
          assert.ok(await js('window.fixture.video().currentTime')>=position-0.2,'Return must preserve position');
          assert.equal(await js('window.fixture.video().textTracks[0].mode'),'showing');
          assert.equal(await js('document.querySelectorAll(".player-header .media-info-toggle").length'),1);
          assert.equal(await js('document.querySelectorAll(".player-header .media-player-close").length'),1);
          assert.equal(await js('document.querySelectorAll(".player-footer .floating-player-actions").length'),0);
          assert.notEqual(await js('getComputedStyle(document.querySelector("video")).getPropertyValue("-webkit-app-region")'),'drag');
          assert.equal(BrowserWindow.getAllWindows().length,1);
          console.log('restored');await js('document.querySelector(".player-floating-toggle").click()');await wait('window.fixture.result().floating');
          const second=BrowserWindow.getAllWindows().find(w=>w!==win);
          for(let n=0;n<100;n++){if(await second.webContents.executeJavaScript('document.querySelector("video")?.readyState>=2'))break;await delay(40)}
          await second.webContents.executeJavaScript('document.querySelector("video").pause();document.querySelector("video").currentTime=10');
          await js('document.querySelector(".floating-player-return button").click()');await wait('!window.fixture.result().floating');
          await wait('window.fixture.video().readyState>=2 && window.fixture.video().paused && window.fixture.video().currentTime>=9.9');
          await js('document.querySelector(".player-floating-toggle").click()');await wait('window.fixture.result().floating');
          const third=BrowserWindow.getAllWindows().find(w=>w!==win);
          const closedBeforeVideo=await js('window.fixture.result().closed.length');
          await third.webContents.executeJavaScript('document.querySelector(".player-footer .media-player-close").click()');await wait('window.fixture.result().closed.length==='+String(closedBeforeVideo+1));
          for(let n=0;n<100 && BrowserWindow.getAllWindows().length!==1;n++)await delay(40);
          assert.equal(BrowserWindow.getAllWindows().length,1);assert.equal(await js('window.fixture.video().getAttribute("src")'),null);
          assert.equal(await js('window.fixture.result().floating'),false);
          await js('window.fixture.reopen()');await wait('document.querySelector("video")?.readyState>=2');
          win.webContents.setWindowOpenHandler(()=>({action:'deny'}));await js('document.querySelector(".player-floating-toggle").click()');await wait('!!document.querySelector(".floating-player-error")');
          assert.equal(await js('window.fixture.result().floating'),false);assert.equal(await js('!!document.querySelector("video")'),true);
          await js('window.fixture.stop()');await wait('!document.querySelector("video")');
          // Windows Server can request reduced motion. Exercise both preferences explicitly.
          win.webContents.debugger.attach('1.3');
          await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
          await wait('!window.matchMedia("(prefers-reduced-motion: reduce)").matches');
          // Observe real animation creation rather than racing its short active lifetime over IPC.
          await js('(()=>{window.recordTransitions=[];window.nativeAnimate=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=window.nativeAnimate.apply(this,args);if(this.classList.contains("audio-record-motion"))window.recordTransitions.push({frames:animation.effect.getKeyframes(),duration:animation.effect.getTiming().duration});return animation};})()');
          win.showInactive();await js('window.fixture.openAudio()');await wait('document.querySelector("audio")?.readyState>=2');
          await js('window.originalAudio=document.querySelector("audio");document.querySelector(".play-btn").click()');
          await wait('window.originalAudio.currentTime>0 && !window.originalAudio.paused');
          await js('document.querySelector(".player-artwork-trigger").click()');await wait('document.querySelector(".player-artwork-change") && !document.querySelector(".player-artwork-change").disabled');
          await js('document.querySelector(".player-artwork-change").click()');await wait('!!document.querySelector(".audio-cover-image") && !window.originalAudio.paused');
          if(process.env.CORTEX_FLOATING_CAPTURE){await delay(200);fs.writeFileSync(path.join(process.env.CORTEX_FLOATING_CAPTURE,'audio-cover-menu.png'),(await win.webContents.capturePage()).toPNG());}
          const editedTime=await js('window.originalAudio.currentTime');
          await js('window.fixture.coverMode("cancel");document.querySelector(".player-artwork-change").click()');
          await wait('!document.querySelector(".player-artwork-saving") && window.originalAudio.readyState>=2 && !window.originalAudio.paused && !document.querySelector(".player-artwork-change").disabled');
          assert.ok(await js('window.originalAudio.currentTime')>=editedTime-.1,'Cancelled selection must resume playback');
          await js('window.originalAudio.pause();window.originalAudio.currentTime=6;window.fixture.coverMode("fail");document.querySelector(".player-artwork-remove").click()');
          await wait('!!document.querySelector(".player-artwork-menu [role=alert]") && window.originalAudio.readyState>=2 && window.originalAudio.currentTime>=5.9');
          assert.equal(await js('window.originalAudio.paused'),true,'Failed save must keep a paused player paused');
          await js('window.fixture.coverMode("save");document.querySelector(".player-artwork-remove").click()');
          await wait('!document.querySelector(".audio-cover-image") && window.originalAudio.readyState>=2 && window.originalAudio.currentTime>=5.9');
          assert.equal(await js('document.querySelector("audio")===window.originalAudio'),true);
          await js('document.querySelector(".player-artwork-trigger").click();window.originalAudio.play()');await wait('!window.originalAudio.paused');
          const audioTime=await js('window.originalAudio.currentTime');
          await js('document.querySelector(".player-floating-toggle").click()');await wait('!!document.querySelector(".audio-view-wrapper.mini-mode")');
          assert.equal(await js('document.querySelector("audio")===window.originalAudio'),true,'Minimizing must preserve the audio element');
          const recordTransition=await js('window.recordTransitions.at(-1)');
          assert.ok(recordTransition,'Record must animate into the dock');
          assert.equal(recordTransition.duration,320);
          assert.notEqual(recordTransition.frames[0].transform,recordTransition.frames.at(-1).transform,'Transition must move the record into its new position');
          await delay(400);assert.ok(await js('window.originalAudio.currentTime')>audioTime);
          const miniBounds=await js('(()=>{const r=document.querySelector(".mini-mode").getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
          assert.ok(miniBounds.left>=0&&miniBounds.right<=miniBounds.width&&miniBounds.bottom<=miniBounds.height,JSON.stringify(miniBounds));
          assert.equal(await js('document.elementFromPoint(100,100)?.closest(".media-player-overlay")'),null,'Mini player must leave the app clickable');
          await js('(()=>{const input=document.querySelector(".mini-volume-slider");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"0.42");input.dispatchEvent(new Event("input",{bubbles:true}))})()');
          await wait('Math.abs(window.originalAudio.volume-0.42)<0.01');
          await js('document.querySelector(".mini-mute").click()');await wait('window.originalAudio.volume===0');
          await js('document.querySelector(".mini-mute").click()');await wait('Math.abs(window.originalAudio.volume-0.42)<0.01');
          await js('document.querySelector(".mini-play").click()');await wait('window.originalAudio.paused');
          await js('document.querySelector(".mini-play").click()');await wait('!window.originalAudio.paused');
          if(process.env.CORTEX_FLOATING_CAPTURE)fs.writeFileSync(path.join(process.env.CORTEX_FLOATING_CAPTURE,'audio-mini-wide.png'),(await win.webContents.capturePage()).toPNG());
          await js('document.querySelector(".mini-expand").click()');await wait('!!document.querySelector(".audio-view-wrapper.fullscreen-mode")');
          assert.equal(await js('document.querySelector("audio")===window.originalAudio && !window.originalAudio.paused'),true,'Expanding must preserve playback');
          assert.equal(await js('document.querySelector(".player-footer").style.opacity'),'1','Expanded controls must reappear');
          await delay(80);
          const expandedFooter=await js('(()=>{const r=document.querySelector(".player-footer").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()');
          assert.ok(expandedFooter.left>=0&&expandedFooter.right<=expandedFooter.width,'Controls must stay centered during expansion: '+JSON.stringify(expandedFooter));
          for(let i=0;i<4;i++){await js('document.querySelector(".player-floating-toggle").click();document.querySelector(".mini-expand").click()');}
          await wait('document.querySelector(".audio-record-motion").getAnimations().length===0');
          await js('document.querySelector(".player-floating-toggle").click()');await delay(350);win.setSize(360,500);await delay(100);
          const narrow=await js('(()=>{const r=document.querySelector(".mini-mode").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth}})()');
          assert.ok(narrow.left>=0&&narrow.right<=narrow.width,JSON.stringify(narrow));assert.equal(narrow.scroll,narrow.width);
          if(process.env.CORTEX_FLOATING_CAPTURE)fs.writeFileSync(path.join(process.env.CORTEX_FLOATING_CAPTURE,'audio-mini-narrow.png'),(await win.webContents.capturePage()).toPNG());
          await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
          await wait('window.matchMedia("(prefers-reduced-motion: reduce)").matches');
          const transitionsBeforeReduce=await js('window.recordTransitions.length');
          await js('document.querySelector(".mini-expand").click();document.querySelector(".player-floating-toggle").click()');
          assert.equal(await js('window.recordTransitions.length'),transitionsBeforeReduce,'Reduced motion must not create a record transition');
          assert.equal(await js('document.querySelector(".audio-record-motion").getAnimations().length'),0,'Reduced motion must skip the transition');
          await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});win.webContents.debugger.detach();
          const sessionsBeforeClose=await js('window.fixture.result().closed.length');
          await js('document.querySelector(".mini-control-btn.close").click()');assert.equal(await js('window.originalAudio.paused'),true,'Closing must stop sound immediately');
          await wait('!document.querySelector("audio") && window.fixture.result().closed.length==='+String(sessionsBeforeClose+1));
          assert.equal(await js('window.originalAudio.getAttribute("src")'),null,'Closing must release the audio resource');
          assert.equal(await js('(async()=> (await window.__cortexMediaDiagnostics()).renderer.audioContexts)()'),0,'Closing must release the visualizer audio graph');
          win.destroy();app.quit();
        }).catch(error=>{console.error(error);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
        let timedOut = false
        const timer = setTimeout(() => { timedOut = true; if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { child.kill() } } else child.kill() }, 45000)
        child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); timedOut ? reject(new Error('Floating test timed out: ' + output)) : resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally {
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
      if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-floating-player-')) await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})

suite('Window chrome', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn } = require('node:child_process')

  test('Windows header retains native caption controls and reserves a draggable area above English and Arabic content', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-window-chrome-')), root = path.resolve(__dirname, '..')
    try {
      const esbuild = require('esbuild')
      for (const [source, output] of [['Back-End/electron/windowChrome.ts', 'chrome.cjs'], ['Back-End/electron/preload.ts', 'preload.cjs']]) {
        esbuild.buildSync({ entryPoints: [path.join(root, source)], bundle: true, platform: 'node', external: ['electron'], format: 'cjs', outfile: path.join(directory, output) })
      }
      esbuild.buildSync({ stdin: { contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import Sidebar from './Front-End/src/components/Sidebar';
        import AddDownloadTab from './Front-End/src/components/AddDownloadTab';
        import {useSettingsStore} from './Front-End/src/stores/useSettingsStore';
        import './Front-End/src/App.css';
        window.fixture={language:lang=>useSettingsStore.setState({lang})};
        function View(){const lang=useSettingsStore(s=>s.lang);return <div className={'app-container'+(window.cortexDl.customTitleBar?' has-titlebar':'')} dir={lang==='ar'?'rtl':'ltr'}>
          <div className="app-titlebar" aria-hidden="true"><div className="app-titlebar-drag"/></div><Sidebar/><main className="main-content"><AddDownloadTab/></main></div>}
        useSettingsStore.setState({lang:'en'});createRoot(document.getElementById('root')).render(<View/>);
      `, resolveDir: root, loader: 'jsx' }, bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"', __APP_VERSION__: '"test"', __BUILD_SHA__: '"test-build"' } })
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Cortex DL</title><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
        app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
        app.whenReady().then(async()=>{
          const {mainWindowChrome}=require('./chrome.cjs');
          const win=new BrowserWindow({...mainWindowChrome,show:false,width:1100,height:720,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false,preload:path.join(__dirname,'preload.cjs')}}),js=s=>win.webContents.executeJavaScript(s);
          win.setMenu(null);win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});
          const wait=async s=>{for(let n=0;n<80;n++){if(await js(s))return;await new Promise(r=>setTimeout(r,25))}throw Error('Header did not settle: '+s)};
          await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector(".app-titlebar-drag")');
          assert.equal(await js('window.cortexDl.customTitleBar'),true);
          assert.equal(await js('navigator.windowControlsOverlay.visible'),true,'Native Windows controls must remain enabled');
          assert.equal(win.isResizable(),true);assert.equal(win.isMinimizable(),true);assert.equal(win.isMaximizable(),true);assert.equal(win.isClosable(),true);
          for(const lang of ['en','ar']){
            await js('window.fixture.language('+JSON.stringify(lang)+')');await wait('document.querySelector(".app-container").dir==='+JSON.stringify(lang==='ar'?'rtl':'ltr'));
            await wait('document.querySelector(".content-header h1").textContent==='+JSON.stringify(lang==='ar'?'إضافة تنزيل جديد':'Add New Download'));
            const bounds=await js('(()=>{const header=document.querySelector(".app-titlebar"),drag=document.querySelector(".app-titlebar-drag"),r=header.getBoundingClientRect(),d=drag.getBoundingClientRect(),overlay=navigator.windowControlsOverlay.getTitlebarAreaRect();return {text:header.textContent,height:r.height,top:r.top,drag:getComputedStyle(drag).getPropertyValue("-webkit-app-region"),dragX:d.x,dragWidth:d.width,safeX:overlay.x,safeWidth:overlay.width,sidebarTop:document.querySelector(".sidebar").getBoundingClientRect().top,mainTop:document.querySelector(".main-content").getBoundingClientRect().top,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,controls:Array.from(document.querySelectorAll(".main-content button,.main-content input")).every(node=>node.getBoundingClientRect().top>=r.bottom&&getComputedStyle(node).getPropertyValue("-webkit-app-region")!=="drag")}})()');
            assert.equal(bounds.text,'','No duplicate app name or icon in the header');assert.equal(bounds.top,0);assert.ok(bounds.height>0&&bounds.height<=32);
            assert.equal(bounds.drag,'drag');assert.equal(bounds.dragX,bounds.safeX);assert.equal(bounds.dragWidth,bounds.safeWidth,'Drag region must not cover native caption buttons');
            assert.equal(bounds.sidebarTop,bounds.height);assert.equal(bounds.mainTop,bounds.height);assert.equal(bounds.scrollWidth,bounds.width);assert.ok(bounds.controls,'Content stays interactive below the header');
            if(process.env.CORTEX_CHROME_CAPTURE){await new Promise(r=>setTimeout(r,600));fs.writeFileSync(path.join(process.env.CORTEX_CHROME_CAPTURE,'window-chrome-'+lang+'.png'),(await win.webContents.capturePage()).toPNG())}
          }
          win.destroy();app.quit();
        }).catch(error=>{console.error(error);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Window chrome timed out: ' + output)) }, 15000)
        child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})

suite('Player chrome', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn } = require('node:child_process')

  test('video and audio headers stay below native Windows controls, fit long titles and return from fullscreen', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-player-chrome-')), root = path.resolve(__dirname, '..')
    try {
      const esbuild = require('esbuild')
      esbuild.buildSync({ entryPoints: [path.join(root, 'Back-End/electron/windowChrome.ts')], bundle: true, platform: 'node', external: ['electron'], format: 'cjs', outfile: path.join(directory, 'chrome.cjs') })
      esbuild.buildSync({ stdin: { contents: `
        import './tests/fixtures/floatingPlayer.jsx';
        import './Front-End/src/App.css';
        import {useSettingsStore} from './Front-End/src/stores/useSettingsStore';
        window.cortexDl.customTitleBar=true;
        window.fixture.language=lang=>useSettingsStore.setState({lang});
      `, resolveDir: root, loader: 'jsx' }, bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"', __MEDIA_PORT__: '9' } })
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div class="app-container has-titlebar" style="position:fixed;inset:0"><div class="app-titlebar" aria-hidden="true"><div class="app-titlebar-drag"></div></div></div><div id="root"></div><script src="renderer.js"></script></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
        app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
        const delay=ms=>new Promise(r=>setTimeout(r,ms));
        app.whenReady().then(async()=>{
          const {mainWindowChrome}=require('./chrome.cjs');
          const win=new BrowserWindow({...mainWindowChrome,show:false,width:1100,height:720,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
          win.setMenu(null);
          const js=s=>win.webContents.executeJavaScript(s,true),wait=async s=>{for(let n=0;n<100;n++){if(await js(s))return;await delay(30)}throw Error('Player header did not settle: '+s)};
          const bounds=()=>js('(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};return {native:navigator.windowControlsOverlay.getTitlebarAreaRect().height,overlay:rect(".media-player-overlay"),container:rect(".media-player-container"),header:rect(".player-header"),back:rect(".player-back"),title:rect(".player-header-title"),scroll:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight,topDrag:document.elementFromPoint(60,10)?.className}})()');
          const check=async()=>{const b=await bounds();assert.ok(b.native>0);assert.equal(b.overlay.top,b.native);assert.equal(b.container.top,b.native);assert.equal(b.container.bottom,b.height);assert.equal(b.header.top,b.native);assert.ok(b.back.top>=b.native&&b.back.bottom<=b.header.bottom);assert.ok(b.back.left>=0&&b.back.right<=b.width);assert.ok(b.title.left>=0&&b.title.right<=b.width);assert.equal(b.scroll,b.width);assert.equal(b.topDrag,'app-titlebar-drag');};
          const capture=async name=>{if(process.env.CORTEX_CHROME_CAPTURE){await js('document.querySelector(".media-player-container").dispatchEvent(new MouseEvent("mousemove",{bubbles:true}))');await delay(450);fs.writeFileSync(path.join(process.env.CORTEX_CHROME_CAPTURE,name+'.png'),(await win.webContents.capturePage()).toPNG())}};
          await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector(".player-back")');
          for(const lang of ['en','ar']){await js('window.fixture.language('+JSON.stringify(lang)+')');await wait('document.querySelector(".player-header").dir==='+JSON.stringify(lang==='ar'?'rtl':'ltr'));await check();await capture('player-header-video-'+lang);}
          await js('document.querySelector(".media-info-toggle").click()');await wait('!!document.querySelector(".media-info-panel")');
          assert.equal(await js('(()=>{const r=document.querySelector(".media-info-panel").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=document.querySelector(".player-header").getBoundingClientRect().bottom})()'),true,'Arabic info panel stays in the viewport');
          await js('document.querySelector(".media-info-close").click()');
          await js('document.querySelector(".media-player-container").requestFullscreen()');await wait('!!document.fullscreenElement');
          await wait('document.querySelector(".media-player-container").getBoundingClientRect().top===0');
          const full=await bounds();assert.equal(full.container.bottom,full.height);assert.equal(full.header.top,0);await capture('player-header-fullscreen');
          await js('document.exitFullscreen()');await wait('!document.fullscreenElement');await wait('document.querySelector(".media-player-container").getBoundingClientRect().top===navigator.windowControlsOverlay.getTitlebarAreaRect().height');await check();
          await js('document.querySelector(".player-back").click()');await wait('!document.querySelector(".media-player-overlay")');assert.equal(await js('window.fixture.result().closed.length'),1);
          await js('window.fixture.openAudio()');await wait('!!document.querySelector("audio")');await check();await capture('player-header-audio-ar');
          win.setSize(360,500);await delay(150);await check();
          await js('document.querySelector(".player-floating-toggle").click()');await wait('!!document.querySelector(".audio-view-wrapper.mini-mode")');
          assert.equal(await js('getComputedStyle(document.querySelector(".player-header")).display'),'none');
          assert.equal(await js('document.elementFromPoint(60,10)?.className'),'app-titlebar-drag');
          await js('document.querySelector(".mini-expand").click()');await wait('!!document.querySelector(".audio-view-wrapper.fullscreen-mode")');await check();
          await js('window.fixture.language("en")');await wait('document.querySelector(".player-header").dir==="ltr"');await capture('player-header-audio-narrow');
          await js('document.querySelector(".player-back").click()');await wait('!document.querySelector("audio")');assert.equal(await js('window.fixture.result().closed.length'),2);
          win.destroy();app.quit();
        }).catch(error=>{console.error(error);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Player chrome timed out: ' + output)) }, 23000)
        child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  })
})

suite('Trim preview', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const http = require('node:http')
  const cp = require('node:child_process')
  const Module = require('node:module')
  const load = Module._load
  Module._load = function(request,parent,...rest) {
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
    if(request==='electron-log')return {info(){},warn(){},error(){}}
    if(request==='electron')return {Notification:{},BrowserWindow:{}}
    return load.call(this,request,parent,...rest)
  }
  const { TrimPreview, validatePreviewUrl, videoFailure, seekPreview } = require('../Front-End/src/components/AdvancedTrimmer/trimPreview.ts')
  const { getTrimPreviewSource } = require('../Front-End/src/components/AdvancedTrimmer/trimSource.ts')
  const { playablePreviewUrl, playablePreviewStreams, extractPreview, extractPreviewStreams, PREVIEW_FORMAT, TRIM_PREVIEW_FORMAT } = require('../Back-End/electron/services/thumbnailService.ts')
  const { syncTrimAudio } = require('../Front-End/src/components/AdvancedTrimmer/trimAudio.ts')
  const { MediaRequestRegistry } = require('../Back-End/electron/services/mediaService.ts')
  const valid = {url:'https://example.com/video.mp4',ext:'mp4',vcodec:'avc1.64001f',acodec:'mp4a.40.2',protocol:'https'}
  test('Visual Trim validates progressive Chromium codec/container, expiration and media error details', () => {
    assert.equal(playablePreviewUrl(valid),valid.url)
    for(const bad of [{vcodec:'av01'}, {ext:'mkv'},{protocol:'m3u8_native'}, {acodec:'ac3'}, {acodec:'none'}, {acodec:undefined}, {requested_formats:[{},{}]}, {url:valid.url+'?expire=1'}])assert.throws(()=>playablePreviewUrl({...valid,...bad}))
    assert.throws(()=>validatePreviewUrl(valid.url+'?expires=1'),/Expired/)
    assert.match(PREVIEW_FORMAT,/avc1/)
    assert.match(PREVIEW_FORMAT,/vcodec\^=vp09/)
    assert.match(PREVIEW_FORMAT,/acodec!=none/)
    assert.doesNotMatch(PREVIEW_FORMAT,/\bbv\[/)
    assert.equal(playablePreviewUrl({...valid,ext:'webm',vcodec:'vp09.00.51.08',acodec:'opus'}),valid.url)
    for(const code of [1,2,3,4])assert.match(videoFailure({error:{code,message:'specific decoder/network detail'}}),/specific decoder\/network detail/)
  })
  test('Visual Trim always chooses a supported muxed source with audio', () => {
    const silentHighResolution = {...valid, formatId:'1080-silent', height:1080, acodec:'none'}
    const audibleLowResolution = {...valid, formatId:'720-muxed', height:720}
    const modernVp9 = {...valid, url:'https://example.com/modern.webm', formatId:'modern-vp09', ext:'webm', vcodec:'vp09.00.51.08', acodec:'opus', height:1080}
    assert.deepEqual(getTrimPreviewSource([silentHighResolution, audibleLowResolution], '1080p', 120), {videoUrl:valid.url, duration:120})
    assert.deepEqual(getTrimPreviewSource([modernVp9], '1080p', 120), {videoUrl:modernVp9.url, duration:120})
    assert.deepEqual(getTrimPreviewSource([silentHighResolution], '1080p', 120), {videoUrl:'', duration:120})
    assert.deepEqual(getTrimPreviewSource([], '1080p', 120), {videoUrl:'', duration:120})
    assert.equal(getTrimPreviewSource([audibleLowResolution], '720p', 0), null)
  })
  test('Visual Trim supports adaptive video/audio, rejects manifests and synchronizes the audio clock', async () => {
    const video = {...valid, format_id:'video', acodec:'none', height:720}
    const audio = {...valid, format_id:'audio', vcodec:'none', ext:'m4a', url:'https://example.com/audio.m4a'}
    assert.deepEqual(playablePreviewStreams({requested_formats:[video,audio]}), {videoUrl:video.url,audioUrl:audio.url})
    assert.throws(()=>playablePreviewStreams({requested_formats:[video,{...audio,protocol:'m3u8_native'}]}), /progressive/)
    assert.throws(()=>playablePreviewStreams({requested_formats:[video]}), /exactly one/)
    const clock={currentTime:12,volume:.35,muted:false,playbackRate:1.5,paused:false,seeking:false,readyState:4}
    const sound={currentTime:0,duration:100,readyState:4,getAttribute:()=>audio.url,play:async()=>{sound.paused=false},pause:()=>{sound.paused=true}}
    await syncTrimAudio(clock,sound,true)
    assert.equal(sound.currentTime,12); assert.equal(sound.volume,.35); assert.equal(sound.playbackRate,1.5); assert.equal(sound.paused,false)
    clock.paused=true; clock.muted=true; await syncTrimAudio(clock,sound)
    assert.equal(sound.paused,true); assert.equal(sound.muted,true)
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-adaptive-selector-'))
    try {
      const info=path.join(dir,'info.json')
      await fs.writeFile(info,JSON.stringify({id:'adaptive',title:'adaptive',extractor:'fixture',webpage_url:'https://example.com/watch',formats:[video,audio]}))
      assert.deepEqual(await extractPreviewStreams(path.join(process.cwd(),'engine-baseline','yt-dlp.exe'),['--load-info-json',info,'--dump-single-json','--skip-download','-f',TRIM_PREVIEW_FORMAT]),{videoUrl:video.url,audioUrl:audio.url})
    } finally { await fs.rm(dir,{recursive:true,force:true}) }
  })
  test('Visual Trim suppresses late extraction results and queues seek until metadata', async () => {
    let resolve; const updates=[]
    const preview=new TrimPreview(valid.url,(...args)=>updates.push(args))
    const pending=preview.start(()=>new Promise(r=>resolve=r)); preview.dispose(); resolve(valid.url); await pending
    assert.equal(updates.length,1)
    const video={readyState:0,currentTime:0,duration:664}
    assert.equal(seekPreview(video,120),false); video.readyState=1
    assert.equal(seekPreview(video,120),true); assert.equal(video.currentTime,120)
  })
  test('Visual Trim cancels and retires real extraction processes across 20 close cycles', async () => {
    for(let i=0;i<20;i++) {
      const registry=new MediaRequestRegistry(); const session='trim-'+i
      const extraction=extractPreview(process.execPath,['-e','setTimeout(()=>{},60000)'],{isClosed:()=>registry.isClosed(session),track:stop=>registry.track(session,'probe',stop)})
      const rejection=assert.rejects(extraction,/cancelled/)
      await registry.closeSession(session); await rejection
      assert.equal(registry.snapshot().probeProcesses,0)
      await assert.rejects(extractPreview(process.execPath,[],{isClosed:()=>true}),/cancelled/)
    }
  })
  test('Visual Trim extraction preserves actual yt-dlp stderr failure', async () => {
    await assert.rejects(extractPreview(process.execPath,['-e',"console.error('HTTP Error 403: expired signed URL');process.exit(1)"]),/HTTP Error 403: expired signed URL/)
    assert.equal(await extractPreview(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(valid))})`]),valid.url)
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-selector-'))
    try {
      const info=path.join(dir,'info.json')
      await fs.writeFile(info,JSON.stringify({id:'preview',title:'preview',extractor:'fixture',webpage_url:'https://example.com/watch',formats:[
        {...valid,format_id:'silent-high-resolution',height:1080,acodec:'none'},
        {...valid,format_id:'compatible',height:360},
        {...valid,format_id:'incompatible',height:1080,ext:'webm',vcodec:'av01.0.12M.08'},
      ]}))
      assert.equal(await extractPreview(path.join(process.cwd(),'engine-baseline','yt-dlp.exe'),['--load-info-json',info,'--dump-single-json','--skip-download','-f',PREVIEW_FORMAT]),valid.url)
      const modern = {...valid, url:'https://example.com/modern.webm', ext:'webm', vcodec:'vp09.00.51.08', acodec:'opus', format_id:'modern-vp09', height:1080}
      await fs.writeFile(info,JSON.stringify({id:'modern-preview',title:'modern preview',extractor:'fixture',webpage_url:'https://example.com/watch',formats:[modern]}))
      assert.equal(await extractPreview(path.join(process.cwd(),'engine-baseline','yt-dlp.exe'),['--load-info-json',info,'--dump-single-json','--skip-download','-f',PREVIEW_FORMAT]),modern.url)
    } finally { await fs.rm(dir,{recursive:true,force:true}) }
  })
  test('Visual Trim Electron plays adaptive audio, falls back, seeks and releases 26 sessions', {timeout:90000}, async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-trim-'))
    let server
    try {
      const fixture=path.join(dir,'video.mp4')
      const ffmpeg=cp.spawnSync(path.join(process.cwd(),'engine-baseline','ffmpeg.exe'),['-y','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x64:rate=20:duration=3','-f','lavfi','-i','sine=duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',fixture])
      assert.equal(ffmpeg.status,0,String(ffmpeg.stderr))
      for(const [filename,map] of [['silent.mp4','0:v'],['audio.m4a','0:a']]) {
        const split=cp.spawnSync(path.join(process.cwd(),'engine-baseline','ffmpeg.exe'),['-y','-loglevel','error','-i',fixture,'-map',map,'-c','copy',path.join(dir,filename)])
        assert.equal(split.status,0,String(split.stderr))
      }
      const bundle=await require('esbuild').build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {Simulate} from 'react-dom/test-utils';import Trimmer from './Front-End/src/components/AdvancedTrimmer/AdvancedTrimmer';import AddTab from './Front-End/src/components/AddDownloadTab';import {useUIStore} from './Front-End/src/stores/useUIStore';import {useFormStore} from './Front-End/src/stores/useFormStore';let root;window.mountAdd=(url)=>{useUIStore.setState({url,analyzeResult:{kind:'ytdlp',title:'fixture',duration:664,formats:[],subtitles:[]}});useFormStore.setState({isAudioMode:false});root=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(AddTab)))};window.mount=props=>{root=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(Trimmer,props)))};window.unmount=()=>{flushSync(()=>root.unmount())};window.change=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');input.value=value;flushSync(()=>Simulate.change(input))}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},format:'iife',define:{'process.env.NODE_ENV':'"development"'}})
      const video=await fs.readFile(fixture)
      const assets={'/video.mp4':video,'/silent.mp4':await fs.readFile(path.join(dir,'silent.mp4')),'/audio.m4a':await fs.readFile(path.join(dir,'audio.m4a'))}
      server=http.createServer((req,res)=>{
        if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return}
        if(req.url.startsWith('/bad.mp4')){res.writeHead(403);res.end('Expired');return}
        const bytes=assets[req.url.split('?')[0]]
        if(bytes) {
          const start=Number((req.headers.range||'bytes=0-').match(/bytes=(\d+)/)?.[1]||0)
          res.writeHead(req.headers.range?206:200,{'Content-Type':req.url.startsWith('/audio')?'audio/mp4':'video/mp4','Accept-Ranges':'bytes','Content-Length':bytes.length-start,...(req.headers.range?{'Content-Range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});res.end(bytes.subarray(start));return
        }
        res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')
      }); await new Promise(r=>server.listen(0,'127.0.0.1',r))
      const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE
      const electron=path.join(process.cwd(),'node_modules','electron','dist','electron.exe')
      const child=cp.spawn(electron,['--no-sandbox','--disable-gpu',path.join(__dirname,'fixtures','trimPreviewElectron.cjs'),`http://127.0.0.1:${server.address().port}/`],{env,windowsHide:true})
      let output=''; child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d)
      const timer=setTimeout(()=>child.kill(),80000)
      const code=await new Promise((r,j)=>{child.on('error',j);child.on('close',r)});clearTimeout(timer)
      assert.equal(code,0,output); assert.match(output,/TRIM_RESULT=.*"electronPlayback":true/)
      const source=await fs.readFile(path.join(process.cwd(),'Front-End/src/components/AddDownloadTab.tsx'),'utf8')
      assert.match(source,/originalUrl=\{url\}/)
    } finally { if(server)await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true}) }
  })
})

suite('Media lifecycle', test => {
  const assert = require('node:assert/strict')
  const http = require('node:http')
  const os = require('node:os')
  const path = require('node:path')
  const fs = require('node:fs/promises')
  const { createReadStream } = require('node:fs')
  const { Transform } = require('node:stream')
  const { MediaRequestRegistry } = require('../Back-End/electron/services/mediaService.ts')
  const { releaseMediaElement, clearMediaCanvas, releaseAudioGraph, stopPlayerFrame } = require('../Front-End/src/components/MediaPlayer/mediaSession.ts')

  test('video and audio elements release their sources and canvas buffers across 20 sessions each', () => {
    for (const kind of ['video', 'audio']) {
      for (let i = 0; i < 20; i++) {
        const calls = []
        const sources = [{ removeAttribute: name => calls.push(`track:${name}`) }]
        const element = {
          currentTime: 40,
          pause: () => calls.push('pause'),
          removeAttribute: name => calls.push(`media:${name}`),
          querySelectorAll: () => sources,
          load: () => calls.push('load'),
        }
        const canvas = {
          width: 160,
          height: 90,
          getContext: () => ({ clearRect: () => calls.push('clear') }),
        }
        releaseMediaElement(element)
        clearMediaCanvas(canvas)
        assert.equal(element.currentTime, 0, kind)
        assert.deepEqual(calls, ['pause', 'media:src', 'track:src', 'load', 'clear'])
        assert.equal(canvas.width, 0)
        assert.equal(canvas.height, 0)
      }
    }
  })

  test('20 audio sessions close their graphs and stop visualizer and ambilight frames', async () => {
    for (let i = 0; i < 20; i++) {
      const canceled = []
      const calls = []
      const analyser = { disconnect: () => calls.push('analyser') }
      const source = { disconnect: node => { assert.equal(node, analyser); calls.push('source') } }
      const context = { close: async () => { calls.push('close') } }
      stopPlayerFrame(i + 1, id => canceled.push(id))
      stopPlayerFrame(i + 100, id => canceled.push(id))
      await releaseAudioGraph(context, source, analyser)
      assert.deepEqual(canceled, [i + 1, i + 100])
      assert.deepEqual(calls, ['source', 'analyser', 'close'])
    }
  })

  test('closing a player session stops its active file stream and subtitle process', async () => {
    const registry = new MediaRequestRegistry()
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-media-session-'))
    const fixture = path.join(directory, 'fixture.mp4')
    await fs.writeFile(fixture, Buffer.alloc(1024 * 1024, 7))
    const server = http.createServer((req, res) => {
      const session = req.url.slice(1)
      if (registry.isClosed(session)) { res.writeHead(410); res.end(); return }
      assert.equal(req.headers.range, 'bytes=0-65535')
      res.writeHead(206, { 'Content-Range': 'bytes 0-65535/1048576', 'Content-Length': 65536 })
      const file = createReadStream(fixture, { start: 0, end: 65535, highWaterMark: 1024 })
      const slow = new Transform({ transform(chunk, _encoding, callback) {
        setTimeout(() => callback(null, chunk), 2)
      } })
      let ended = false
      let untrack = () => {}
      const stop = () => {
        if (ended) return
        ended = true
        file.destroy()
        slow.destroy()
        res.destroy()
      }
      res.on('close', stop)
      file.on('close', () => { untrack(); stop() })
      untrack = registry.track(session, 'stream', stop)
      file.pipe(slow).pipe(res)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      for (let i = 0; i < 20; i++) {
        const session = `session-${i}`
        const response = await new Promise((resolve, reject) => {
          const request = http.get(`http://127.0.0.1:${server.address().port}/${session}`, { headers: { Range: 'bytes=0-65535' } }, resolve)
          request.on('error', reject)
        })
        response.pause()
        assert.equal(response.statusCode, 206)
        assert.equal(registry.snapshot().streams, 1)
        let childStopped = 0
        let untrackSubtitle = () => {}
        untrackSubtitle = registry.track(session, 'subtitle', () => { childStopped++; untrackSubtitle() })
        assert.equal(registry.snapshot().ffmpegProcesses, 1)
        let untrackProbe = () => {}
        untrackProbe = registry.track(session, 'probe', () => { childStopped++; untrackProbe() })
        assert.equal(registry.snapshot().probeProcesses, 1)
        await registry.closeSession(session)
        response.destroy()
        assert.equal(registry.snapshot().streams, 0)
        assert.equal(registry.snapshot().ffmpegProcesses, 0)
        assert.equal(registry.snapshot().probeProcesses, 0)
        assert.equal(childStopped, 2)
        assert.equal(registry.isClosed(session), true)
        let lateStopped = 0
        registry.track(session, 'stream', () => { lateStopped++ })
        assert.equal(lateStopped, 1, 'late requests must not restart a closed session')
      }
      await registry.closeAll()
      assert.equal(registry.snapshot().streams, 0)
      assert.equal(registry.isClosed(null), true)
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
