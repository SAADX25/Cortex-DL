const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process')
test('analysis failure shows a localized bot-verification alert without legacy caption controls or empty batch button', { timeout: 35000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-analysis-failure-'))
  try {
    require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/youtubeAnalysisFailure.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"', '__APP_VERSION__': '"2.2.0"', '__BUILD_SHA__': '"fixture"' } })
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>body{margin:0;padding:20px;background:#0d1829;color:#e4edf8;font-family:Arial}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    await fs.writeFile(path.join(directory, 'electron.cjs'), `
      const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
      app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
      const delay=ms=>new Promise(r=>setTimeout(r,ms));
      app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,width:830,height:760,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}}),js=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){throw Error(s+': '+e.message)}};
        win.webContents.on('console-message', (_event, ...args) => console.log(...args));
        const wait=async s=>{for(let n=0;n<60;n++){if(await js(s))return;await delay(50)}throw Error('UI did not settle: '+s)};
        const capture=async name=>{if(process.env.CORTEX_ANALYSIS_FAILURE_CAPTURE){await delay(180);fs.writeFileSync(path.join(process.env.CORTEX_ANALYSIS_FAILURE_CAPTURE,name+'.png'),(await win.webContents.capturePage()).toPNG())}};
        await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector(".hero-input-wrapper button:last-child")');
        const analyze='document.querySelector(".hero-input-wrapper button:last-child").click()';
        await js(analyze);await wait('!!document.querySelector(".global-error-banner")');
        assert.match(await js('document.querySelector(".global-error-banner").textContent'),/bot verification/);
        assert.equal(await js('document.querySelector(".global-error-banner").getAttribute("role")'),'alert');
        assert.equal(await js('!!document.querySelector(".download-main-btn-large")'),false);
        assert.equal(await js('!!document.querySelector(".youtube-status,.subtitle-language-control")'),false);
        assert.doesNotMatch(await js('document.body.innerText'),/select a local file in Subtitles|Subtitles off|Captions available|cookies/);
        await capture('analysis-failure-en');
        await js('window.fixture.language("ar")');await js(analyze);await wait('document.querySelector(".global-error-banner")?.getAttribute("dir")==="rtl"');
        assert.match(await js('document.querySelector(".global-error-banner").textContent'),/رفض YouTube/);
        await capture('analysis-failure-ar');
        await js('window.fixture.batch()');await wait('!!document.querySelector(".download-main-btn-large")');
        assert.equal(await js('document.querySelector(".download-main-btn-large").disabled'),false,'Nonempty batch should remain usable');
        win.destroy();app.quit();
      }).catch(e=>{console.error(e);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Analysis failure UI timed out: ' + output)) }, 30000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
  } finally { if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-analysis-failure-')) await fs.rm(directory, { recursive: true, force: true }) }
})
