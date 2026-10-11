const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
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
