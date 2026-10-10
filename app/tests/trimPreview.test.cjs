require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const cp = require('node:child_process')
const Module = require('node:module')
const load = Module._load
Module._load = function(request,parent,...rest) {
  if (request === './engineReadiness' || request === '../engineReadiness') return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
  if(request==='electron-log')return {info(){},warn(){},error(){}}
  if(request==='electron')return {Notification:{},BrowserWindow:{}}
  return load.call(this,request,parent,...rest)
}
const { TrimPreview, validatePreviewUrl, videoFailure, seekPreview } = require('../Front-End/src/components/trimPreview.ts')
const { getTrimPreviewSource } = require('../Front-End/src/components/trimSource.ts')
const { playablePreviewUrl, playablePreviewStreams, extractPreview, extractPreviewStreams, PREVIEW_FORMAT, TRIM_PREVIEW_FORMAT } = require('../Back-End/electron/previewExtraction.ts')
const { syncTrimAudio } = require('../Front-End/src/components/trimAudio.ts')
const { MediaRequestRegistry } = require('../Back-End/electron/mediaRequestRegistry.ts')
const valid = {url:'https://example.com/video.mp4',ext:'mp4',vcodec:'avc1.64001f',acodec:'mp4a.40.2',protocol:'https'}
test('Visual Trim validates progressive Chromium codec/container, expiration and media error details', () => {
  assert.equal(playablePreviewUrl(valid),valid.url)
  for(const bad of [{vcodec:'av01'}, {ext:'mkv'},{protocol:'m3u8_native'}, {acodec:'ac3'}, {acodec:'none'}, {acodec:undefined}, {requested_formats:[{},{}]}, {url:valid.url+'?expire=1'}])assert.throws(()=>playablePreviewUrl({...valid,...bad}))
  assert.throws(()=>validatePreviewUrl(valid.url+'?expires=1'),/Expired/)
  assert.match(PREVIEW_FORMAT,/avc1/)
  assert.match(PREVIEW_FORMAT,/vcodec\^=vp09/)
  assert.match(PREVIEW_FORMAT,/acodec!=none/)
  assert.doesNotMatch(PREVIEW_FORMAT,/\bbv\[/)
  assert.equal(playablePreviewUrl({...valid,ext:'webm',vcodec:'vp09.00.51.08',acodec:'opus'}),valid.url)
  for(const code of [1,2,3,4])assert.match(videoFailure({error:{code,message:'specific decoder/network detail'}}),/specific decoder\/network detail/)
})
test('Visual Trim always chooses a supported muxed source with audio', () => {
  const silentHighResolution = {...valid, formatId:'1080-silent', height:1080, acodec:'none'}
  const audibleLowResolution = {...valid, formatId:'720-muxed', height:720}
  const modernVp9 = {...valid, url:'https://example.com/modern.webm', formatId:'modern-vp09', ext:'webm', vcodec:'vp09.00.51.08', acodec:'opus', height:1080}
  assert.deepEqual(getTrimPreviewSource([silentHighResolution, audibleLowResolution], '1080p', 120), {videoUrl:valid.url, duration:120})
  assert.deepEqual(getTrimPreviewSource([modernVp9], '1080p', 120), {videoUrl:modernVp9.url, duration:120})
  assert.deepEqual(getTrimPreviewSource([silentHighResolution], '1080p', 120), {videoUrl:'', duration:120})
  assert.deepEqual(getTrimPreviewSource([], '1080p', 120), {videoUrl:'', duration:120})
  assert.equal(getTrimPreviewSource([audibleLowResolution], '720p', 0), null)
})
test('Visual Trim supports adaptive video/audio, rejects manifests and synchronizes the audio clock', async () => {
  const video = {...valid, format_id:'video', acodec:'none', height:720}
  const audio = {...valid, format_id:'audio', vcodec:'none', ext:'m4a', url:'https://example.com/audio.m4a'}
  assert.deepEqual(playablePreviewStreams({requested_formats:[video,audio]}), {videoUrl:video.url,audioUrl:audio.url})
  assert.throws(()=>playablePreviewStreams({requested_formats:[video,{...audio,protocol:'m3u8_native'}]}), /progressive/)
  assert.throws(()=>playablePreviewStreams({requested_formats:[video]}), /exactly one/)
  const clock={currentTime:12,volume:.35,muted:false,playbackRate:1.5,paused:false,seeking:false,readyState:4}
  const sound={currentTime:0,duration:100,readyState:4,getAttribute:()=>audio.url,play:async()=>{sound.paused=false},pause:()=>{sound.paused=true}}
  await syncTrimAudio(clock,sound,true)
  assert.equal(sound.currentTime,12); assert.equal(sound.volume,.35); assert.equal(sound.playbackRate,1.5); assert.equal(sound.paused,false)
  clock.paused=true; clock.muted=true; await syncTrimAudio(clock,sound)
  assert.equal(sound.paused,true); assert.equal(sound.muted,true)
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-adaptive-selector-'))
  try {
    const info=path.join(dir,'info.json')
    await fs.writeFile(info,JSON.stringify({id:'adaptive',title:'adaptive',extractor:'fixture',webpage_url:'https://example.com/watch',formats:[video,audio]}))
    assert.deepEqual(await extractPreviewStreams(path.join(process.cwd(),'engine-baseline','yt-dlp.exe'),['--load-info-json',info,'--dump-single-json','--skip-download','-f',TRIM_PREVIEW_FORMAT]),{videoUrl:video.url,audioUrl:audio.url})
  } finally { await fs.rm(dir,{recursive:true,force:true}) }
})
test('Visual Trim suppresses late extraction results and queues seek until metadata', async () => {
  let resolve; const updates=[]
  const preview=new TrimPreview(valid.url,(...args)=>updates.push(args))
  const pending=preview.start(()=>new Promise(r=>resolve=r)); preview.dispose(); resolve(valid.url); await pending
  assert.equal(updates.length,1)
  const video={readyState:0,currentTime:0,duration:664}
  assert.equal(seekPreview(video,120),false); video.readyState=1
  assert.equal(seekPreview(video,120),true); assert.equal(video.currentTime,120)
})
test('Visual Trim cancels and retires real extraction processes across 20 close cycles', async () => {
  for(let i=0;i<20;i++) {
    const registry=new MediaRequestRegistry(); const session='trim-'+i
    const extraction=extractPreview(process.execPath,['-e','setTimeout(()=>{},60000)'],{isClosed:()=>registry.isClosed(session),track:stop=>registry.track(session,'probe',stop)})
    const rejection=assert.rejects(extraction,/cancelled/)
    await registry.closeSession(session); await rejection
    assert.equal(registry.snapshot().probeProcesses,0)
    await assert.rejects(extractPreview(process.execPath,[],{isClosed:()=>true}),/cancelled/)
  }
})
test('Visual Trim extraction preserves actual yt-dlp stderr failure', async () => {
  await assert.rejects(extractPreview(process.execPath,['-e',"console.error('HTTP Error 403: expired signed URL');process.exit(1)"]),/HTTP Error 403: expired signed URL/)
  assert.equal(await extractPreview(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(valid))})`]),valid.url)
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-selector-'))
  try {
    const info=path.join(dir,'info.json')
    await fs.writeFile(info,JSON.stringify({id:'preview',title:'preview',extractor:'fixture',webpage_url:'https://example.com/watch',formats:[
      {...valid,format_id:'silent-high-resolution',height:1080,acodec:'none'},
      {...valid,format_id:'compatible',height:360},
      {...valid,format_id:'incompatible',height:1080,ext:'webm',vcodec:'av01.0.12M.08'},
    ]}))
    assert.equal(await extractPreview(path.join(process.cwd(),'engine-baseline','yt-dlp.exe'),['--load-info-json',info,'--dump-single-json','--skip-download','-f',PREVIEW_FORMAT]),valid.url)
    const modern = {...valid, url:'https://example.com/modern.webm', ext:'webm', vcodec:'vp09.00.51.08', acodec:'opus', format_id:'modern-vp09', height:1080}
    await fs.writeFile(info,JSON.stringify({id:'modern-preview',title:'modern preview',extractor:'fixture',webpage_url:'https://example.com/watch',formats:[modern]}))
    assert.equal(await extractPreview(path.join(process.cwd(),'engine-baseline','yt-dlp.exe'),['--load-info-json',info,'--dump-single-json','--skip-download','-f',PREVIEW_FORMAT]),modern.url)
  } finally { await fs.rm(dir,{recursive:true,force:true}) }
})
test('Visual Trim Electron plays adaptive audio, falls back, seeks and releases 26 sessions', {timeout:90000}, async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-trim-'))
  let server
  try {
    const fixture=path.join(dir,'video.mp4')
    const ffmpeg=cp.spawnSync(path.join(process.cwd(),'engine-baseline','ffmpeg.exe'),['-y','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x64:rate=20:duration=3','-f','lavfi','-i','sine=duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',fixture])
    assert.equal(ffmpeg.status,0,String(ffmpeg.stderr))
    for(const [filename,map] of [['silent.mp4','0:v'],['audio.m4a','0:a']]) {
      const split=cp.spawnSync(path.join(process.cwd(),'engine-baseline','ffmpeg.exe'),['-y','-loglevel','error','-i',fixture,'-map',map,'-c','copy',path.join(dir,filename)])
      assert.equal(split.status,0,String(split.stderr))
    }
    const bundle=await require('esbuild').build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {Simulate} from 'react-dom/test-utils';import Trimmer from './Front-End/src/components/AdvancedTrimmer';import AddTab from './Front-End/src/components/AddDownloadTab';import {useUIStore} from './Front-End/src/stores/useUIStore';import {useFormStore} from './Front-End/src/stores/useFormStore';let root;window.mountAdd=(url)=>{useUIStore.setState({url,analyzeResult:{kind:'ytdlp',title:'fixture',duration:664,formats:[],subtitles:[]}});useFormStore.setState({isAudioMode:false});root=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(AddTab)))};window.mount=props=>{root=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(Trimmer,props)))};window.unmount=()=>{flushSync(()=>root.unmount())};window.change=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');input.value=value;flushSync(()=>Simulate.change(input))}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},format:'iife',define:{'process.env.NODE_ENV':'"development"'}})
    const video=await fs.readFile(fixture)
    const assets={'/video.mp4':video,'/silent.mp4':await fs.readFile(path.join(dir,'silent.mp4')),'/audio.m4a':await fs.readFile(path.join(dir,'audio.m4a'))}
    server=http.createServer((req,res)=>{
      if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return}
      if(req.url.startsWith('/bad.mp4')){res.writeHead(403);res.end('Expired');return}
      const bytes=assets[req.url.split('?')[0]]
      if(bytes) {
        const start=Number((req.headers.range||'bytes=0-').match(/bytes=(\d+)/)?.[1]||0)
        res.writeHead(req.headers.range?206:200,{'Content-Type':req.url.startsWith('/audio')?'audio/mp4':'video/mp4','Accept-Ranges':'bytes','Content-Length':bytes.length-start,...(req.headers.range?{'Content-Range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});res.end(bytes.subarray(start));return
      }
      res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')
    }); await new Promise(r=>server.listen(0,'127.0.0.1',r))
    const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE
    const electron=path.join(process.cwd(),'node_modules','electron','dist','electron.exe')
    const child=cp.spawn(electron,['--no-sandbox','--disable-gpu',path.join(__dirname,'fixtures','trimPreviewElectron.cjs'),`http://127.0.0.1:${server.address().port}/`],{env,windowsHide:true})
    let output=''; child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d)
    const timer=setTimeout(()=>child.kill(),80000)
    const code=await new Promise((r,j)=>{child.on('error',j);child.on('close',r)});clearTimeout(timer)
    assert.equal(code,0,output); assert.match(output,/TRIM_RESULT=.*"electronPlayback":true/)
    const source=await fs.readFile(path.join(process.cwd(),'Front-End/src/components/AddDownloadTab.tsx'),'utf8')
    assert.match(source,/originalUrl=\{url\}/)
  } finally { if(server)await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true}) }
})
