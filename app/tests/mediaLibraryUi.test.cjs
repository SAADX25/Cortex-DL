const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process')
const { execFileSync } = require('node:child_process')
test('media library UI imports, filters, plays, relocates, confirms removal and handles drops/errors with responsive Arabic layout', { timeout: 40000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-library-ui-'))
  try {
    const image = input => 'data:image/jpeg;base64,' + execFileSync(path.resolve(__dirname, '../engine-baseline/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', input, '-frames:v', '1', '-threads', '1', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1'], { windowsHide: true, timeout: 10000 }).toString('base64')
    require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/mediaLibrary.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"', __LIBRARY_VIDEO_ART__: JSON.stringify(image('testsrc2=size=320x180')), __LIBRARY_AUDIO_ART__: JSON.stringify(image('color=c=0x5b4091:size=180x180')) } })
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    await fs.writeFile(path.join(directory, 'electron.cjs'), `
      const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
      app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
      const delay=ms=>new Promise(r=>setTimeout(r,ms));
      app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,width:1080,height:850,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}}),js=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){throw Error(s+': '+e.message)}};
        win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});
        const wait=async s=>{for(let n=0;n<80;n++){if(await js(s))return;await delay(35)}throw Error('UI did not settle: '+s)};
        const capture=async name=>{if(process.env.CORTEX_LIBRARY_CAPTURE){await delay(150);fs.writeFileSync(path.join(process.env.CORTEX_LIBRARY_CAPTURE,name+'.png'),(await win.webContents.capturePage()).toPNG())}};
        const search=async value=>{await js('(()=>{const input=document.querySelector(".library-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(value)+');input.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(50)};
        await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector(".nav-item:nth-child(3)")');
        await js('document.querySelector(".nav-item:nth-child(3)").click()');await wait('!document.querySelector(".library-loading")');
        assert.equal(await js('document.querySelectorAll(".library-card").length'),0);assert.equal(await js('!!document.querySelector(".library-drop")'),true);await capture('library-empty');
        await js('window.fixture.canceled(true);document.querySelector(".library-header .library-add").click()');await delay(80);
        assert.equal(await js('document.querySelectorAll(".library-card").length'),0,'Canceled file picker must not change the library');
        await js('window.fixture.canceled(false);document.querySelector(".library-header .library-add").click()');await wait('document.querySelectorAll(".library-card").length===3');await capture('library-en');
        assert.equal(await js('!!document.querySelector(".library-drop")'),false,'Populated library must not waste space on the drop banner');
        // Artwork loads only near the viewport; row heights vary with runner fonts/DPI.
        for(const selector of ['.library-card.video','.library-card.audio:not(.is-unavailable)']) {
          await js('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center",behavior:"instant"})');
          await wait('document.querySelector('+JSON.stringify(selector+' .library-thumbnail img')+')?.naturalWidth>0');
        }
        await js('document.querySelector(".main-content").scrollTop=0');
        const assertRows=async()=>{
          const rows=await js('Array.from(document.querySelectorAll(".library-card")).map(card=>{const r=card.getBoundingClientRect(),t=card.querySelector(".library-thumbnail").getBoundingClientRect(),b=card.querySelector(".library-card-details").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,imageRight:t.right,imageLeft:t.left,bodyLeft:b.left,bodyRight:b.right,rtl:document.querySelector(".media-library").dir==="rtl"}})');
          for(let i=0;i<rows.length;i++){
            const row=rows[i];assert.ok(row.width>row.height,'Library items must be horizontal rectangles: '+JSON.stringify(row));
            assert.ok(row.rtl?row.bodyRight<=row.imageLeft:row.imageRight<=row.bodyLeft,'Artwork must sit beside the details');
            if(i){assert.equal(row.left,rows[0].left);assert.equal(row.right,rows[0].right);assert.ok(row.top>=rows[i-1].bottom,'Library must use one row per file');}
          }
          assert.equal(await js('Array.from(document.querySelectorAll(".library-card button")).every(button=>{const b=button.getBoundingClientRect(),r=button.closest(".library-card").getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.bottom<=r.bottom})'),true,'Controls must fit inside each row');
        };
        await assertRows();
        await js('window.fixture.openAudioPlayer();document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").click()');
        await wait('!!document.querySelector(".library-notice.is-error")');assert.match(await js('document.querySelector(".library-notice.is-error").textContent'),/Close this file/);
        assert.deepEqual(await js('window.fixture.result().covers'),[],'An active media source must not be rewritten under the player');
        await js('window.fixture.closePlayer()');
        win.setContentSize(1600,850);await delay(150);await assertRows();await capture('library-wide-rows');
        win.setContentSize(1080,850);await delay(150);
        assert.equal(await js('document.querySelector(".is-unavailable .library-thumbnail img")'),null,'Missing artwork must retain the icon');
        assert.equal(await js('document.querySelector(".library-card.video .library-cover-button").textContent.includes("Add cover")'),true,'A generated video frame is not an embedded cover');
        assert.equal(await js('document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").textContent.includes("Change cover")'),true,'Existing embedded covers must be editable without adding a custom cover first');
        assert.ok(await js('!!document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-remove")'));
        await js('window.coverBefore=document.querySelector(".library-card.audio:not(.is-unavailable) img").src;window.fixture.canceled(true);document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").click()');await delay(80);
        assert.deepEqual(await js('window.fixture.result().covers'),[]);
        await js('window.fixture.canceled(false);window.fixture.artworkFailure(true);document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").click()');
        await wait('!!document.querySelector(".library-notice.is-error")');assert.match(await js('document.querySelector(".library-notice.is-error").textContent'),/8 MB/);
        assert.equal(await js('document.querySelector(".library-card.audio:not(.is-unavailable) img").src===window.coverBefore'),true);
        await js('window.fixture.artworkFailure(false);window.fixture.holdArtwork();document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").click()');
        await wait('!!document.querySelector(".library-card.audio:not(.is-unavailable) [role=progressbar]")');
        assert.equal(await js('document.querySelectorAll(".library-card [role=progressbar]").length'),1,'Progress must belong to the edited file');
        assert.equal(await js('document.querySelector(".library-card [role=progressbar]").hasAttribute("aria-valuenow")'),false,'Do not invent a percentage for file rewriting');
        await capture('library-cover-loading');
        await js('window.fixture.releaseArtwork()');
        await wait('document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").textContent.includes("Change cover")');
        await wait('document.querySelector(".library-card.audio:not(.is-unavailable) img").src!==window.coverBefore');
        assert.equal(await js('!!document.querySelector(".artwork-progress")'),false,'Progress must disappear when saving completes');
        assert.equal(await js('!!document.querySelector(".library-cover-embed")'),false,'New covers must be embedded immediately');
        assert.match(await js('document.querySelector(".library-cover-saved").textContent'),/saved to file/);
        await capture('library-custom-cover');
        await assertRows();
        await js('window.fixture.legacyCover()');await wait('!!document.querySelector(".library-cover-embed")');await assertRows();await capture('library-legacy-cover');
        await js('document.querySelector(".library-cover-embed").click()');await wait('!document.querySelector(".library-cover-embed")');
        assert.deepEqual(await js('window.fixture.result().embedded'),['audio']);
        assert.equal(await js('!!document.querySelector(".library-cover-saved")'),true);
        await js('window.fixture.refresh()');await delay(80);
        assert.ok(await js('!!document.querySelector(".library-cover-remove")'),'Refreshing must retain the assigned cover');
        await js('document.querySelector(".library-cover-remove").click()');await wait('!document.querySelector(".library-cover-remove")');
        assert.equal(await js('!!document.querySelector(".library-cover-saved")'),false);
        await wait('!document.querySelector(".library-card.audio:not(.is-unavailable) img")');
        assert.equal(await js('document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").textContent.includes("Add cover")'),true);
        await js('window.fixture.nativeVideoCover()');await wait('!!document.querySelector(".library-card.video .library-cover-remove")');
        assert.equal(await js('document.querySelector(".library-card.video .library-cover-button").textContent.includes("Change cover")'),true);
        await capture('library-existing-mp4-cover');
        await js('document.querySelector(".library-card.video .library-cover-remove").click()');await wait('!document.querySelector(".library-card.video .library-cover-remove")');
        await wait('document.querySelector(".library-card.video .library-cover-button").textContent.includes("Add cover")');
        await js('document.querySelector(".library-card.video .library-cover-button").click()');await wait('!!document.querySelector(".library-card.video .library-cover-remove")');
        await capture('library-changed-mp4-cover');
        await js('document.querySelector(".library-card.video .library-cover-remove").click()');await wait('!document.querySelector(".library-card.video .library-cover-remove")');
        assert.equal(await js('document.querySelector(".nav-item:nth-child(3)").getAttribute("aria-current")'),'page');
        await js('document.querySelectorAll(".library-filters button")[1].click()');await wait('document.querySelectorAll(".library-card").length===1');
        await js('document.querySelector(".library-play").click()');await wait('window.fixture.result().played.length===1');
        assert.equal(await js('window.fixture.result().player.filePath'),'C:/Videos/رحلة إلى عمّان.mp4');await js('window.fixture.closePlayer()');
        await js('document.querySelector(".library-card-actions button:nth-child(2)").click()');await wait('window.fixture.result().folders.length===1');
        await js('document.querySelector(".library-remove").click()');await wait('!!document.querySelector("[role=dialog]")');
        assert.match(await js('document.querySelector(".modal-body").textContent'),/file stays/);
        await js('document.querySelector(".modal-footer button:first-child").click()');await wait('!document.querySelector("[role=dialog]")');
        assert.deepEqual(await js('window.fixture.result().removed'),[]);
        await js('document.querySelector(".library-remove").click()');await wait('!!document.querySelector("[role=dialog]")');
        await js('document.querySelector(".modal-footer button:last-child").click()');await wait('window.fixture.result().removed.length===1');
        await js('document.querySelectorAll(".library-filters button")[0].click()');await wait('document.querySelectorAll(".library-card").length===2');
        await search('no-match');await wait('!!document.querySelector(".library-no-results")');
        await js('document.querySelector(".library-no-results button").click()');await wait('document.querySelectorAll(".library-card").length===2');
        await js('document.querySelector(".is-unavailable .library-play").click()');await wait('!document.querySelector(".is-unavailable")');
        await js('document.querySelector(".media-library").dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true,cancelable:true}))');
        assert.equal(await js('document.activeElement.classList.contains("library-search") || document.activeElement.parentElement.classList.contains("library-search")'),true);
        await js('(()=>{const data=new DataTransfer();data.items.add(new File(["audio"],"dropped.mp3"));data.items.add(new File(["exe"],"invalid.exe"));document.querySelector(".media-library").dispatchEvent(new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true}))})()');
        await wait('window.fixture.result().dropped.length===2');assert.deepEqual(await js('window.fixture.result().dropped'),['C:/Dropped/dropped.mp3','C:/Dropped/invalid.exe']);
        await wait('document.querySelector(".library-notice").textContent.includes("could not be added")');
        // A refresh that started before an import must never replace its newer snapshot.
        await js('window.fixture.holdRefresh();window.fixture.refresh();document.querySelector(".library-header .library-add").click()');await delay(100);
        await js('window.fixture.releaseRefresh()');await delay(100);assert.equal(await js('document.querySelectorAll(".library-card").length'),3);
        await js('window.fixture.failure(true);window.fixture.refresh()');await wait('!!document.querySelector(".library-notice.is-error")');
        assert.match(await js('document.querySelector(".library-notice.is-error").textContent'),/saved library/);
        await js('window.fixture.failure(false);window.fixture.restore()');await wait('document.querySelectorAll(".library-card").length===3');
        const selectSize=async size=>{await js('(()=>{const input=document.querySelector(".library-page-size select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(input,'+JSON.stringify(String(size))+');input.dispatchEvent(new Event("change",{bubbles:true}))})()');await delay(60)};
        await js('window.fixture.many()');await wait('document.querySelectorAll(".library-card").length===4');
        assert.equal(await js('document.querySelectorAll(".library-pagination").length'),1,'Library must have one set of page controls');
        await selectSize(8);await wait('document.querySelectorAll(".library-card").length===8');
        const assertSticky=async(offset=600)=>{
          await js('document.querySelector(".main-content").scrollTop='+offset);await delay(100);
          const bounds=await js('(()=>{const content=document.querySelector(".main-content"),viewport=content.getBoundingClientRect(),controls=document.querySelector(".library-controls").getBoundingClientRect();return {scroll:content.scrollTop,top:controls.top,viewportTop:viewport.top,bottom:controls.bottom,viewportBottom:viewport.bottom,visible:Array.from(document.querySelectorAll(".library-search,.library-filters,.library-pagination")).every(node=>{const r=node.getBoundingClientRect();return r.top>=viewport.top&&r.bottom<=viewport.bottom})}})()');
          assert.ok(bounds.scroll>100,'The media list must actually scroll');
          assert.ok(Math.abs(bounds.top-bounds.viewportTop)<1,'Controls must remain pinned at the top: '+JSON.stringify(bounds));
          assert.ok(bounds.visible,'Search, filters and pagination must remain visible while scrolling');
        };
        await assertSticky();await capture('library-sticky-scrolled');await assertSticky(100000);
        await search('Evening');await wait('document.querySelectorAll(".library-card").length===1');
        assert.equal(await js('document.querySelector(".library-page-number").textContent'),'Page 1 of 1','Search must work directly from the scrolled list');
        await search('');await wait('document.querySelectorAll(".library-card").length===8');
        await assertSticky();
        await js('document.querySelector(".library-page-next").click()');await wait('document.querySelectorAll(".library-card").length===1');await delay(300);
        assert.ok(await js('(()=>{const card=document.querySelector(".library-card").getBoundingClientRect(),controls=document.querySelector(".library-controls").getBoundingClientRect();return card.top>=controls.bottom-1&&card.top<innerHeight})()'),'Changing pages must reveal the new first file below the controls');
        await selectSize(2);await wait('document.querySelectorAll(".library-card").length===2');
        assert.equal(await js('document.querySelector(".library-pagination.top .library-page-number").textContent'),'Page 1 of 5');
        assert.equal(await js('document.querySelector(".library-pagination.top .library-page-previous").disabled'),true);
        const firstPage=await js('Array.from(document.querySelectorAll(".library-card h3")).map(item=>item.textContent)');
        await js('document.querySelector(".library-pagination.top .library-page-next").click()');await wait('document.querySelector(".library-pagination.top .library-page-number").textContent.includes("2 of 5")');
        assert.notDeepEqual(await js('Array.from(document.querySelectorAll(".library-card h3")).map(item=>item.textContent)'),firstPage);
        await search('Evening');await wait('document.querySelectorAll(".library-card").length===1');
        assert.equal(await js('document.querySelector(".library-page-number").textContent'),'Page 1 of 1');
        await search('');await wait('document.querySelectorAll(".library-card").length===2');
        for(let i=0;i<4;i++){await js('document.querySelector(".library-pagination.top .library-page-next").click()');await delay(40)}
        await wait('document.querySelector(".library-page-number").textContent.includes("5 of 5")');
        assert.equal(await js('document.querySelectorAll(".library-card").length'),1);
        assert.equal(await js('document.querySelector(".library-pagination.top .library-page-next").disabled'),true);
        await js('document.querySelector(".library-remove").click()');await wait('!!document.querySelector("[role=dialog]")');
        await js('document.querySelector(".modal-footer button:last-child").click()');await wait('document.querySelector(".library-page-number").textContent.includes("4 of 4")');
        assert.equal(await js('document.querySelectorAll(".library-card").length'),2,'Removing the last item of a page must clamp to the remaining last page');
        await js('document.querySelectorAll(".library-filters button")[2].click()');await wait('document.querySelectorAll(".library-card").length===2');
        assert.equal(await js('document.querySelector(".library-page-number").textContent'),'Page 1 of 4');
        await js('document.querySelectorAll(".library-filters button")[0].click()');await wait('document.querySelectorAll(".library-card").length===2');
        await js('document.querySelector(".library-search input").focus()');await delay(80);
        assert.equal(await js('getComputedStyle(document.querySelector(".library-search input")).outlineStyle'),'none','Focus must outline the whole search bar, not its inner input');
        assert.ok(await js('(()=>{const input=document.querySelector(".library-search input").getBoundingClientRect(),bar=document.querySelector(".library-search").getBoundingClientRect();return input.left>=bar.left&&input.right<=bar.right&&input.top>=bar.top&&input.bottom<=bar.bottom})()'));
        await capture('library-search-pagination');
        await selectSize(4);await js('window.fixture.restore()');await wait('document.querySelectorAll(".library-card").length===3');
        await js('window.fixture.language("ar");document.activeElement.blur();document.querySelector(".main-content").scrollTop=0');await wait('document.querySelector(".media-library").getAttribute("dir")==="rtl"');await assertRows();await capture('library-ar');
        win.setContentSize(650,850);await delay(150);await js('document.querySelector(".main-content").scrollTop=0');await capture('library-ar-narrow');
        await assertRows();
        const bounds=await js('(()=>{const r=document.querySelector(".media-library").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth}})()');
        assert.ok(bounds.left>=0&&bounds.right<=bounds.width,JSON.stringify(bounds));assert.equal(bounds.scroll,bounds.width,'Arabic library must not overflow');
        assert.match(await js('document.querySelector(".library-heading").textContent'),/مكتبة الوسائط/);
        await js('window.fixture.many()');await selectSize(12);await wait('document.querySelectorAll(".library-card").length===9');
        await assertSticky();await capture('library-sticky-ar-narrow');await assertSticky(100000);
        win.setContentSize(1080,850);await js('window.fixture.language("en")');await selectSize(4);
        await js('window.fixture.resetRequests();window.fixture.holdCheck();window.fixture.large()');
        await wait('document.querySelector(".library-count").textContent==="1200"&&document.querySelectorAll(".library-card").length===4');
        await wait('window.fixture.requests().checks.length>0');
        assert.equal(await js('!!document.querySelector(".library-loading")'),false,'A slow availability check must not block the saved library');
        assert.equal(await js('document.querySelector(".library-page-number").textContent'),'Page 1 of 300');
        assert.ok((await js('window.fixture.requests().checks')).every(ids=>ids.length<=4),'Check only the current page in a 1200-file library');
        await js('window.fixture.releaseCheck();document.querySelector(".main-content").scrollTop=0');await delay(200);
        assert.ok(new Set(await js('window.fixture.requests().thumbnails')).size<=4,'Do not generate hidden-page thumbnails');
        await js('document.querySelector(".main-content").scrollTop=100000');await delay(100);
        await js('document.querySelector(".main-content").scrollTop=0');await wait('new Set(window.fixture.requests().thumbnails).size===4');
        const requests=await js('window.fixture.requests().thumbnails.length');
        await js('document.querySelector(".main-content").scrollTop=80');await delay(60);await js('document.querySelector(".main-content").scrollTop=0');await delay(60);
        assert.equal(await js('window.fixture.requests().thumbnails.length'),requests,'Scrolling must not request completed thumbnails again');
        await capture('library-1200-files');
        await js('window.fixture.resetRequests();document.querySelector(".library-page-next").click()');
        await wait('document.querySelector(".library-page-number").textContent.includes("2 of 300")&&window.fixture.requests().checks.length>0');
        assert.ok((await js('window.fixture.requests().checks')).every(ids=>ids.length===4&&ids.every(id=>!['large-1199','large-1198','large-1197','large-1196'].includes(id))),'Changing pages must validate the new page only');
        win.destroy();app.quit();
      }).catch(e=>{console.error(e);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Library UI timed out: ' + output)) }, 35000)
      child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
