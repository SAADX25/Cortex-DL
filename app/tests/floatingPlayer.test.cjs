const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
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
        await js('document.querySelector(".player-artwork-trigger").click()');
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
