const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process')
test('real sandboxed preload resolves native File paths and imports them through the protected library IPC', { timeout: 20000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-library-preload-'))
  try {
    const esbuild = require('esbuild'), root = path.resolve(__dirname, '..')
    for (const [source, output] of [['Back-End/electron/preload.ts', 'preload.cjs'], ['Back-End/electron/ipc/mediaLibraryIpc.ts', 'library.cjs'], ['Back-End/electron/ipcSecurity.ts', 'boundary.cjs']]) {
      esbuild.buildSync({ entryPoints: [path.join(root, source)], bundle: true, platform: 'node', external: ['electron'], format: 'cjs', outfile: path.join(directory, output) })
    }
    const source = path.join(directory, 'صوت local.WAV'); await fs.writeFile(source, 'untouched media')
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><body><input type="file" multiple></body></html>')
    await fs.writeFile(path.join(directory, 'electron.cjs'), `
      const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
      app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
      app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'preload.cjs')}});
        require('./boundary.cjs').installIpcBoundary(()=>win);require('./library.cjs').registerMediaLibraryIpc(()=>win);
        await win.loadFile(path.join(__dirname,'index.html'));
        win.webContents.debugger.attach('1.3');const send=(method,args)=>win.webContents.debugger.sendCommand(method,args);
        const document=await send('DOM.getDocument'),input=await send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'input'});
        const source=path.join(__dirname,'صوت local.WAV');await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[source]});
        const js=s=>win.webContents.executeJavaScript(s);
        assert.deepEqual(await js('window.cortexDl.getDroppedMediaPaths(Array.from(document.querySelector("input").files))'),[source]);
        assert.deepEqual(await js('window.cortexDl.getDroppedMediaPaths([new File(["text"],"artificial.mp4")])'),[]);
        const result=await js('window.cortexDl.addMediaLibraryFiles(window.cortexDl.getDroppedMediaPaths(Array.from(document.querySelector("input").files)))');
        assert.equal(result.added,1);assert.equal(result.items[0].kind,'audio');assert.equal(result.items[0].filePath,source);
        assert.equal((await js('window.cortexDl.listMediaLibrary()')).length,1);
        assert.equal((await js('window.cortexDl.checkMediaLibraryFiles(['+JSON.stringify(result.items[0].id)+'])'))[0].availability,'available');
        await assert.rejects(js('window.cortexDl.checkMediaLibraryFiles(["../unregistered"])'),/Invalid library items/);
        assert.equal((await js('window.cortexDl.removeMediaLibraryArtwork('+JSON.stringify(result.items[0].id)+')')).length,1);
        await assert.rejects(js('window.cortexDl.selectMediaLibraryArtwork("../unregistered")'),/Invalid library item/);
        await assert.rejects(js('window.cortexDl.embedMediaLibraryArtwork("../unregistered")'),/Invalid library item/);
        await assert.rejects(js('window.cortexDl.getMediaLibraryArtworkInfo("../unregistered")'),/Invalid library item/);
        await assert.rejects(js('window.cortexDl.embedMediaLibraryArtwork('+JSON.stringify(result.items[0].id)+')'),/ARTWORK_UNSUPPORTED/);
        await assert.rejects(js('window.cortexDl.addMediaLibraryFiles(["relative.mp4"])'),/Invalid library paths/);
        assert.equal(fs.readFileSync(source,'utf8'),'untouched media');
        win.webContents.debugger.detach();win.destroy();app.quit();
      }).catch(error=>{console.error(error);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Library preload timed out: ' + output)) }, 15000)
      child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
