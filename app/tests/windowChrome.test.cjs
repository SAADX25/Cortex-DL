const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
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
