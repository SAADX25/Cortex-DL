const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process')

test('Windows artwork setting persists, switches Arabic layout and passes explicit refresh consent for every cover action', { timeout: 25000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-windows-artwork-ui-')), root = path.resolve(__dirname, '..')
  try {
    require('esbuild').buildSync({ stdin: { contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import SettingsTab from './Front-End/src/components/SettingsTab';
      import {useSettingsStore} from './Front-End/src/stores/useSettingsStore';
      import {useMediaLibraryStore} from './Front-End/src/stores/useMediaLibraryStore';
      import './Front-End/src/App.css';
      const calls=[];
      window.cortexDl={selectMediaLibraryArtwork:async(id,flag)=>{calls.push(['select',flag]);return null},removeMediaLibraryArtwork:async(id,flag)=>{calls.push(['remove',flag]);return []},embedMediaLibraryArtwork:async(id,flag)=>{calls.push(['embed',flag]);return []}};
      window.fixture={calls:()=>calls,lang:lang=>useSettingsStore.setState({lang}),edit:async()=>{const s=useMediaLibraryStore.getState();await s.selectArtwork('song');await s.removeArtwork('song');await s.embedArtwork('song')}};
      function View(){const lang=useSettingsStore(s=>s.lang);return <div className="app-container" dir={lang==='ar'?'rtl':'ltr'}><main className="main-content"><SettingsTab/></main></div>}
      createRoot(document.getElementById('root')).render(<View/>);
    `, resolveDir: root, loader: 'jsx' }, bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"', __APP_VERSION__: '"test"', __BUILD_SHA__: '"test-build"' } })
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    await fs.writeFile(path.join(directory, 'electron.cjs'), `
      const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
      app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
      app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,width:1080,height:850,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}}),js=s=>win.webContents.executeJavaScript(s);
        win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});
        const wait=async s=>{for(let n=0;n<60;n++){if(await js(s))return;await new Promise(r=>setTimeout(r,30))}throw Error('UI did not settle: '+s)};
        await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector("button[role=switch]")');
        assert.equal(await js('document.querySelector("button[role=switch]").getAttribute("aria-checked")'),'true');
        await js('window.fixture.edit()');assert.deepEqual(await js('window.fixture.calls()'),[['select',true],['remove',true],['embed',true]]);
        await js('document.querySelector("button[role=switch]").click()');await wait('document.querySelector("button[role=switch]").getAttribute("aria-checked")==="false"');
        assert.equal(await js('localStorage.getItem("cortex-refresh-windows-artwork")'),'false');
        await js('window.fixture.edit()');assert.deepEqual((await js('window.fixture.calls()')).slice(-3),[['select',false],['remove',false],['embed',false]]);
        await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait('!!document.querySelector("button[role=switch]")');assert.equal(await js('document.querySelector("button[role=switch]").getAttribute("aria-checked")'),'false');
        await js('window.fixture.lang("ar")');await wait('document.querySelector("button[role=switch]").getAttribute("aria-label").includes("تحديث")');
        await js('document.querySelector("button[role=switch]").scrollIntoView({block:"center",behavior:"instant"})');
        assert.equal(await js('document.querySelector(".app-container").dir'),'rtl');
        assert.equal(await js('document.documentElement.scrollWidth<=window.innerWidth'),true);
        if(process.env.CORTEX_ARTWORK_CAPTURE){await new Promise(r=>setTimeout(r,200));fs.writeFileSync(process.env.CORTEX_ARTWORK_CAPTURE,(await win.webContents.capturePage()).toPNG())}
        win.destroy();app.quit();
      }).catch(error=>{console.error(error);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Windows artwork UI timed out: ' + output)) }, 20000)
      child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
