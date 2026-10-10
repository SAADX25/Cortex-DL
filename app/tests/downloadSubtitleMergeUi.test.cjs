const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process')
test('download merge button discovers sidecars, selects language/MP4, cancels and opens the saved video, with responsive Arabic layout', { timeout: 35000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-merge-ui-'))
  try {
    require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/downloadSubtitleMerge.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' } })
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>body{margin:0;padding:20px;background:#0d1829;color:#e4edf8;font-family:Arial}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    await fs.writeFile(path.join(directory, 'electron.cjs'), `
      const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
      app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
      const delay=ms=>new Promise(r=>setTimeout(r,ms));
      app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,width:850,height:740,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}}),js=s=>win.webContents.executeJavaScript(s);
        const wait=async s=>{for(let n=0;n<60;n++){if(await js(s))return;await delay(50)}throw Error('UI did not settle: '+s)};
        const capture=async name=>{if(process.env.CORTEX_MERGE_CAPTURE){await delay(180);fs.writeFileSync(path.join(process.env.CORTEX_MERGE_CAPTURE,name+'.png'),(await win.webContents.capturePage()).toPNG())}};
        await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector(".dc-card")');await delay(100);
        assert.equal(await js('!!document.querySelector(".dc-merge")'),false,'Must hide without subtitles');
        await js('window.fixture.tracks()');await wait('!!document.querySelector(".dc-merge")');await capture('merge-card');
        await js('document.querySelector(".dc-merge").click()');await wait('!!document.querySelector(".dsm-dialog")');
        assert.equal(await js('document.querySelectorAll(".dsm-file").length'),2);
        assert.match(await js('document.querySelector(".dsm-formats input:checked").parentElement.textContent'),/MP4/);
        await capture('merge-en');
        await js('document.querySelectorAll(".dsm-file input")[1].click();document.querySelector(".dsm-save").click()');await wait('!!document.querySelector(".dsm-busy")');
        assert.deepEqual(await js('window.fixture.request()'),['fixture','Nightcore_-_If_U_Seek_Amy_-_(Lyrics).en.vtt','mp4']);
        assert.equal(await js('document.querySelector(".dsm-files").disabled'),true);
        await js('document.querySelector(".dsm-footer button").click()');await wait('!!document.querySelector(".dsm-save")');
        assert.equal(await js('window.fixture.result().canceled'),1);
        await js('document.querySelectorAll(".dsm-file input")[0].click();document.querySelector(".dsm-save").click()');await wait('!!document.querySelector(".dsm-busy")');
        await js('window.fixture.finish()');await wait('!!document.querySelector(".dsm-success")');
        await js('document.querySelector(".dsm-play").click()');await wait('!document.querySelector(".dsm-dialog")');
        assert.equal(await js('window.fixture.result().opened'),'C:/fixture/video.subtitled.mp4');
        await js('window.fixture.language("ar");document.querySelector(".dc-merge").click()');await wait('document.querySelector(".dsm-dialog")?.getAttribute("dir")==="rtl"');
        await capture('merge-ar');win.setContentSize(430,700);await delay(150);await capture('merge-ar-narrow');
        const bounds=await js('(()=>{const r=document.querySelector(".dsm-dialog").getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,top:r.top,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth}})()');
        assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height,JSON.stringify(bounds));
        assert.equal(bounds.scroll,bounds.width,'Narrow Arabic must not overflow');
        await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');await wait('!document.querySelector(".dsm-dialog")');
        await js('window.fixture.noTracks()');await wait('!document.querySelector(".dc-merge")');
        win.destroy();app.quit();
      }).catch(e=>{console.error(e);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Merge UI timed out: ' + output)) }, 30000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
  } finally { if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-merge-ui-')) await fs.rm(directory, { recursive: true, force: true }) }
})
