const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process')

test('subtitle menu names languages, selects/off, dismisses safely and supports keyboard without player shortcuts', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-subtitle-menu-'))
  try {
    require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/subtitleMenu.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' } })
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body style="margin:0"><div id="root"></div><script src="renderer.js"></script></body></html>')
    await fs.writeFile(path.join(directory, 'electron.cjs'), `
      const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),path=require('node:path');
      app.disableHardwareAcceleration();
      app.setPath('userData',path.join(__dirname,'profile'));
      const delay=ms=>new Promise(r=>setTimeout(r,ms));
      app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,width:900,height:600,webPreferences:{offscreen:true,backgroundThrottling:false}});
        const js=s=>win.webContents.executeJavaScript(s);
        const wait=async(s,label)=>{for(let n=0;n<60;n++){if(await js(s))return;await delay(30)}throw Error(label)};
        const key=async name=>{await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:'+JSON.stringify(name)+',bubbles:true,cancelable:true}))');await delay(40)};
        await win.loadFile(path.join(__dirname,'index.html'));
        await wait('!!document.querySelector(".subtitle-trigger")','Trigger missing');
        assert.match(await js('document.querySelector(".subtitle-current").textContent'),/Arabic/);
        assert.equal(await js('!!document.querySelector("select")'),false);
        await js('document.querySelector(".subtitle-trigger").click()');
        await wait('!!document.querySelector(".subtitle-menu")','Menu missing');
        assert.equal(await js('document.activeElement.getAttribute("aria-checked")'),'true');
        if(process.env.CORTEX_SUBTITLE_MENU_CAPTURE){await delay(250);require('node:fs').writeFileSync(path.join(process.env.CORTEX_SUBTITLE_MENU_CAPTURE,'subtitle-menu-wide.png'),(await win.webContents.capturePage()).toPNG());}
        assert.deepEqual(await js('window.fixture.result().changes'),[],'Opening must not switch subtitles off');
        await key('ArrowDown');await key('Enter');
        await wait('!document.querySelector(".subtitle-menu")','Selection did not close menu');
        assert.deepEqual(await js('window.fixture.result().changes'),[1]);
        assert.equal(await js('document.activeElement.classList.contains("subtitle-trigger")'),true);
        await js('document.querySelector(".subtitle-trigger").click()');await wait('!!document.querySelector(".subtitle-menu")','Reopen');
        await key('Escape');
        assert.equal(await js('!!document.querySelector(".subtitle-menu")'),false);
        assert.equal(await js('window.fixture.result().escapes'),0,'Escape must not close the player');
        await js('document.querySelector(".subtitle-trigger").click()');await wait('!!document.querySelector(".subtitle-menu")','Reopen for outside');
        await js('document.querySelector("#outside").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
        await wait('!document.querySelector(".subtitle-menu")','Outside click did not close menu');
        await js('document.querySelector(".subtitle-trigger").click()');await wait('!!document.querySelector(".subtitle-menu")','Reopen for off');
        await key('Home');await key(' ');
        await wait('document.querySelector(".subtitle-current").textContent === "Off"','Off missing');
        assert.deepEqual(await js('window.fixture.result().changes'),[1,-1]);
        await js('window.fixture.language("ar");document.querySelector(".subtitle-trigger").click()');
        await wait('document.querySelector(".subtitle-menu")?.getAttribute("dir") === "rtl"','Arabic menu missing');
        await wait('document.activeElement.getAttribute("role") === "menuitemradio"','Arabic menu focus missing');
        assert.match(await js('document.querySelectorAll(".subtitle-option")[1].textContent'),/العربية/);
        assert.match(await js('document.querySelectorAll(".subtitle-option")[3].textContent'),/Custom commentary/);
        win.setSize(430,700);await delay(100);
        const bounds=await js('(()=>{const r=document.querySelector(".subtitle-menu").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:innerWidth,scroll:document.documentElement.scrollWidth}})()');
        assert.ok(bounds.left>=0 && bounds.right<=bounds.width && bounds.top>=0,JSON.stringify(bounds));
        assert.equal(bounds.scroll,bounds.width,'Controls overflow at narrow width');
        if(process.env.CORTEX_SUBTITLE_MENU_CAPTURE){await delay(250);require('node:fs').writeFileSync(path.join(process.env.CORTEX_SUBTITLE_MENU_CAPTURE,'subtitle-menu-ar-narrow.png'),(await win.webContents.capturePage()).toPNG());}
        // An offscreen document has no native focus; emit the focus event generated by Tab in a visible window.
        await js('document.querySelector("#outside").focus();document.querySelector("#outside").dispatchEvent(new FocusEvent("focusin",{bubbles:true}))');
        await wait('!document.querySelector(".subtitle-menu")','Tabbing out must dismiss menu');
        assert.equal(await js('window.fixture.result().plays'),0,'Menu keys must not toggle playback');
        win.destroy();app.quit();
      }).catch(e=>{console.error(e);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Subtitle menu test timed out: ' + output)) }, 25000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
  } finally { if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-subtitle-menu-')) await fs.rm(directory, { recursive: true, force: true }) }
})
