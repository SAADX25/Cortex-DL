const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const base = process.argv.find(arg => arg.startsWith('http://127.0.0.1:'))
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('js-flags', '--expose-gc')
app.commandLine.appendSwitch('enable-precise-memory-info')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } })
  try {
    await win.loadURL(base)
    const result = await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, reason) => { if (!ok) throw new Error(reason) }
      const wait = async fn => { for(let i=0;i<300;i++){ if(fn())return; await new Promise(r=>setTimeout(r,20)) } throw new Error('Preview condition timed out') }
      const video = () => document.querySelector('video')
      const url = '${base}video.mp4'
      const original = 'https://www.youtube.com/watch?v=fixture'
      let calls = [], closes = [], logs = [], saved, mode = 'success'
      window.cortexDl = {
        getTrimPreviewStreams: async (...args) => {
          if(mode==='adaptive') { calls.push(args); return {videoUrl:'${base}silent.mp4',audioUrl:'${base}audio.m4a'} }
          return {videoUrl:await window.cortexDl.getDirectStreamUrl(...args)}
        },
        getDirectStreamUrl: async (...args) => { calls.push(args); if(mode==='fail')throw new Error('yt-dlp HTTP 403 extraction failure'); if(mode==='expired')return url+'?expire=1'; if(mode==='bad')return '${base}bad.mp4'; return url },
        closeMediaSession: async id => { closes.push(id) },
        logPreviewError: reason => logs.push(reason),
      }
      window.mountAdd(original)
      const toggle=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Advanced Trim'))
      assert(toggle,'Visual Trim opens even without analyzed format URLs')
      toggle.click(); await wait(()=>video()?.readyState>=1)
      assert(calls[0][0]===original,'AddDownloadTab passes originalUrl')
      window.unmount(); calls=[]
      window.mount({originalUrl:original,videoUrl:url+'?fallback=1',duration:664,onConfirm:r=>saved=r})
      await wait(()=>video()?.readyState>=1)
      assert(calls.length===1 && calls[0][0]===original,'original URL extraction')
      assert(video().currentSrc===url && !video().className.includes('hidden'),'extracted video displayed')
      assert(video().videoWidth>0,'Electron decodes H264 MP4')
      assert([...document.querySelectorAll('.advanced-trimmer__range')].every(input=>input.max==='664'),'analyzed duration authoritative')
      assert(video().controls && !video().muted,'native preview sound available by default')
      video().muted=true; await wait(()=>video().muted)
      video().muted=false; await wait(()=>!video().muted)
      video().volume=0.35; await wait(()=>Math.abs(video().volume-0.35)<.01 && !video().muted)
      video().muted=true; video().dispatchEvent(new Event('volumechange'))
      window.change('Trim start',1.1); await wait(()=>Math.abs(video().currentTime-1.1)<.02)
      window.change('Trim end',2.2); await wait(()=>Math.abs(video().currentTime-2.2)<.02)
      video().dispatchEvent(new Event('error')); await wait(()=>video()?.readyState>=1 && video().currentSrc.includes('fallback=1') && Math.abs(video().currentTime-2.2)<.02)
      document.querySelector('.advanced-trimmer__save-btn').click()
      assert(saved.startSeconds===1.1 && saved.endSeconds===2.2,'range saved')
      let old = video(); window.unmount(); assert(!old.hasAttribute('src'),'video source released')
      mode='fail'; window.mount({originalUrl:original,videoUrl:url+'?fallback=1',duration:664,onConfirm:r=>saved=r})
      await wait(()=>video()?.readyState>=1)
      assert(video().currentSrc.includes('fallback=1'),'valid fallback after extraction failure')
      window.unmount()
      mode='bad'; window.mount({originalUrl:original,videoUrl:url+'?fallback=1',duration:664,onConfirm:r=>saved=r})
      await wait(()=>video()?.readyState>=1 && video().currentSrc.includes('fallback=1'))
      window.unmount()
      mode='expired'; window.mount({originalUrl:original,videoUrl:url+'?expire=1',duration:664,onConfirm:r=>saved=r})
      await wait(()=>document.querySelector('[role=status]'))
      assert(document.querySelector('[role=status]').textContent.includes('Expired'),'expiration reason visible')
      window.change('Trim start',10); window.change('Trim end',20)
      document.querySelector('.advanced-trimmer__save-btn').click()
      assert(saved.startSeconds===10 && saved.endSeconds===20,'failed preview still saves range')
      window.unmount()
      window.gc(); const heapBefore=performance.memory.usedJSHeapSize
      mode='adaptive'; window.mount({originalUrl:original,videoUrl:'',duration:3,onConfirm:()=>{}})
      const audio=()=>document.querySelector('[data-trim-audio]')
      await wait(()=>video()?.readyState>=1 && audio()?.readyState>=1)
      assert(video().controls && !document.querySelector('.advanced-trimmer__audio-controls'),'sound controls stay inside video')
      await video().play(); await wait(()=>audio().currentTime>.2 && !audio().paused)
      window.change('Trim start',1.1); await wait(()=>Math.abs(audio().currentTime-video().currentTime)<.2)
      video().volume=.25; await wait(()=>Math.abs(audio().volume-.25)<.01)
      video().muted=true; await wait(()=>audio().muted)
      video().muted=false; await wait(()=>!audio().muted)
      video().pause(); await wait(()=>audio().paused)
      const oldAudio=audio(); window.unmount(); assert(!oldAudio.hasAttribute('src'),'adaptive audio released')
      for(let i=0;i<20;i++) { mode='success'; window.mount({originalUrl:original,videoUrl:url,duration:664,onConfirm:()=>{}}); await wait(()=>video()?.readyState>=1); old=video(); window.unmount(); assert(!old.hasAttribute('src'),'repeated close releases media') }
      await new Promise(r=>setTimeout(r,100)); window.gc()
      assert(performance.memory.usedJSHeapSize-heapBefore<8*1024*1024,'bounded renderer heap across repeated sessions')
      assert(logs.some(reason=>reason.includes('403')) && logs.some(reason=>reason.includes('Expired')), 'actual failure reasons logged')
      assert(new Set(closes).size===26 && closes.length===26,'each unique extraction session closed')
      return { scenarios:6, sessions:closes.length, electronPlayback:true }
    })()`)
    assert.equal(result.electronPlayback, true)
    console.log('TRIM_RESULT='+JSON.stringify(result))
    win.destroy(); app.quit()
  } catch(error) { console.error(error); win.destroy(); app.exit(1) }
})
