const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process')

test('subtitle Generate enables after delayed readiness IPC, and refreshes existing models on focus and tab return', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-subtitle-readiness-'))
  try {
    require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/subtitleReadiness.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' } })
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    await fs.writeFile(path.join(directory, 'electron.cjs'), `
      const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),path=require('node:path');
      app.setPath('userData',path.join(__dirname,'profile'));
      const delay=ms=>new Promise(r=>setTimeout(r,ms));
      app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
        const js=s=>win.webContents.executeJavaScript(s);
        const wait=async(s,label)=>{for(let n=0;n<60;n++){if(await js(s))return;await delay(50)}throw Error(label)};
        await win.loadFile(path.join(__dirname,'index.html'));
        await wait('!!document.querySelector(".ss-setup button") && !document.querySelector(".ss-setup button").disabled','Initial setup readiness');
        await js('document.querySelector(".ss-language-trigger").click()');
        await wait('document.activeElement.matches(".ss-language-search input")','Language search focus missing');
        const languageBounds=await js('(()=>{const menu=document.querySelector(".ss-language-menu").getBoundingClientRect(),list=document.querySelector(".ss-language-list");return {top:menu.top,bottom:menu.bottom,height:menu.height,viewport:innerHeight,scroll:list.scrollHeight>list.clientHeight}})()');
        assert.ok(languageBounds.top>=0 && languageBounds.bottom<=languageBounds.viewport && languageBounds.height<=272,JSON.stringify(languageBounds));
        assert.equal(languageBounds.scroll,true,'Long language list must scroll inside the menu');
        await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true,cancelable:true}))');
        await wait('document.querySelector(".ss-language-option[data-value=uk]").getAttribute("data-highlighted") === "true"','Keyboard navigation to last language failed');
        assert.equal(await js('(()=>{const o=document.querySelector(".ss-language-option[data-value=uk]").getBoundingClientRect(),l=document.querySelector(".ss-language-list").getBoundingClientRect();return o.top>=l.top && o.bottom<=l.bottom+1})()'),true,'Keyboard option must scroll into view');
        await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
        await wait('!document.querySelector(".ss-language-menu")','Language selection did not dismiss menu');
        assert.match(await js('document.querySelector(".ss-language-trigger").textContent'),/Ukrainian/);
        await js('document.querySelector(".ss-language-trigger").click()');await wait('document.activeElement.matches(".ss-language-search input")','Search reopen');
        await js("{const el=document.querySelector('.ss-language-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'English');el.dispatchEvent(new Event('input',{bubbles:true}))}");
        await wait('document.querySelectorAll(".ss-language-option").length===1','Language search did not filter');
        await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
        await wait('!document.querySelector(".ss-language-menu")','Search selection remained open');
        await js('document.querySelectorAll(".ss-language-trigger")[1].click()');await wait('!!document.querySelector(".ss-language-menu")','Subtitle language menu missing');
        await js('document.querySelector(".ss-language-option[data-value=ar]").click()');
        await wait('!document.querySelector(".ss-language-menu")','Subtitle language selection did not close');
        assert.equal(await js('document.querySelector(".ss-primary").disabled'),true);
        await js('document.querySelector(".ss-setup button").click()');
        await wait('!!document.querySelector(".ss-operation")','Installation started');
        await js('window.fixture.complete()');
        await wait('!document.querySelector(".ss-primary").disabled','Generate remained disabled after delayed IPC');
        assert.equal(await js('!!document.querySelector(".ss-setup")'),false);
        await js('window.fixture.models(false);window.dispatchEvent(new Event("focus"))');
        await wait('document.querySelector(".ss-primary").disabled','Focus did not invalidate missing models');
        await js('window.fixture.models(true);window.dispatchEvent(new Event("focus"))');
        await wait('!document.querySelector(".ss-primary").disabled','Focus did not discover existing models');
        await js('window.fixture.tab("downloads")');await delay(150);
        await js('window.fixture.models(false);window.fixture.tab("subtitles")');
        await wait('document.querySelector(".ss-primary").disabled','Tab return did not refresh readiness');
        await js('window.fixture.tab("downloads")');await delay(150);
        await js('window.fixture.models(true);window.fixture.tab("subtitles")');
        await wait('!document.querySelector(".ss-primary").disabled','Tab return did not discover existing models');
        assert.equal(await js('window.fixture.installs()'),1,'Existing models must not require another download');
        await js("{const el=document.querySelector('.ss-content-options select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'music');el.dispatchEvent(new Event('change',{bubbles:true}))}");
        await wait("document.querySelector('.ss-content-options p')?.textContent.includes('full audio')",'Singing hint missing');
        await js('document.querySelector(".ss-primary").click()');
        await wait('!!window.fixture.request()','Subtitle request missing');
        assert.equal(await js('window.fixture.request().recognitionMode'),'music');
        assert.equal(await js('window.fixture.request().sourceLanguage'),'en');
        assert.equal(await js('window.fixture.request().targetLanguage'),'ar');
        assert.equal(await js('Array.from(document.querySelectorAll(".ss-language-trigger")).every(button=>button.disabled)'),true,'Languages must remain locked during processing');
        await js('window.fixture.noSpeech()');
        await wait("document.querySelector('.ss-error')?.textContent.includes('No recognizable words')",'No-speech explanation missing');
        assert.equal(await js('!!document.querySelector(".ss-review")'),false,'Non-verbal output must not offer a completed translation');
        await js('window.fixture.language("ar")');
        await wait("document.querySelector('.ss-error')?.textContent.includes('لم تُكتشف كلمات')",'Arabic no-speech explanation missing');
        await js('window.fixture.gpu()');
        await wait('!!document.querySelector(".ss-gpu-setup")','GPU preparation should be offered for existing CPU models');
        await js("document.querySelector('.ss-compute-options input[value=cpu]').click()");
        await wait('!document.querySelector(".ss-gpu-setup")','CPU mode must not request GPU downloads');
        assert.equal(await js('document.querySelector(".ss-device-status strong").textContent'),'CPU · Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz');
        await js('document.querySelector(".ss-primary").click()');
        await wait('window.fixture.request().compute === "cpu"','CPU selection was not sent');
        await wait("document.querySelector('.ss-active-device')?.textContent.includes('CPU')",'Actual CPU backend missing');
        assert.match(await js('document.querySelector(".ss-active-device").textContent'),/i7-8700/);
        await js('window.fixture.noSpeech()');await wait('!document.querySelector(".ss-operation")','CPU operation did not finish');
        await js("document.querySelector('.ss-compute-options input[value=auto]').click()");
        await wait('!!document.querySelector(".ss-gpu-setup")','Automatic mode must offer GPU engines');
        await js('document.querySelector(".ss-gpu-setup button").click()');
        await wait('!!document.querySelector(".ss-operation")','GPU installation did not start');
        await js('window.fixture.complete()');
        await wait('!document.querySelector(".ss-primary").disabled && !document.querySelector(".ss-gpu-setup")','GPU readiness did not refresh');
        assert.match(await js('document.querySelector(".ss-compute-options").textContent'),/GPU · NVIDIA GeForce GTX 1050 Ti/);
        await js('document.querySelector(".ss-primary").click()');
        await wait("document.querySelector('.ss-active-device')?.textContent.includes('GPU · NVIDIA')",'Actual GPU backend missing');
        assert.equal(await js('document.querySelector(".ss-clear").disabled'),true,'Clear must not erase a running job');
        await js('window.fixture.done()');
        await wait('!!document.querySelector(".ss-review")','Review result missing');
        assert.match(await js('document.querySelector(".ss-clear").textContent'),/مسح جلسة الترجمة/);
        await js('document.querySelector(".ss-clear").click()');
        await wait('!document.querySelector(".ss-review") && !document.querySelector(".ss-clear")','Cleared result remained visible');
        assert.deepEqual(await js('window.fixture.cleared()'),{count:1,state:{id:'',stage:'idle',progress:null},source:'',preview:null});
        assert.equal(await js('document.querySelector(".ss-primary").disabled'),true,'Cleared source must not be regenerated accidentally');
        win.destroy();app.quit();
      }).catch(e=>{console.error(e);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Renderer readiness test timed out: ' + output)) }, 25000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
  } finally { if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-subtitle-readiness-')) await fs.rm(directory, { recursive: true, force: true }) }
})
