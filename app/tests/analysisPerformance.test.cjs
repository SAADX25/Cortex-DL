require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const cp = require('node:child_process')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const originalLoad = Module._load
const handlers = new Map()
let fixture = null
let spawns = []
const binaryRequests = []
Module._load = function(request, parent, ...rest) {
  if (request === './engineReadiness' || request === '../engineReadiness') return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
  if (request === 'electron-log') return { info(){}, warn(){}, error(){} }
  if (request === 'electron') return { app: { isPackaged:false, getPath:()=>os.tmpdir() },
    ipcMain: { handle:(name, fn)=>handlers.set(name,fn), on(){} } }
  if (request === './db' || request === '../db') return { db: { prepare:()=>({get:()=>undefined}) } }
  if ((request === './paths' || request === '../paths') && fixture) return { getBinaryPath:name=>{binaryRequests.push(name);return process.execPath}, getBinDirectory:()=>os.tmpdir() }
  if (request === 'node:child_process' && fixture && parent.filename.endsWith('analysisProcess.ts')) return {
    ...cp, spawn(binary, args, options) {
      spawns.push({binary,args})
      return cp.spawn(process.execPath,['-e',`setTimeout(()=>console.log(${JSON.stringify(JSON.stringify(fixture))}),60)`],options)
    }
  }
  return originalLoad.call(this,request,parent,...rest)
}
const { AnalysisCoordinator } = require('../Back-End/electron/analysisCoordinator.ts')
const { extractAnalysis } = require('../Back-End/electron/analysisProcess.ts')
const { ThumbnailCache } = require('../Back-End/electron/thumbnailCache.ts')
const { CookieValidationCache } = require('../Back-End/electron/cookieValidation.ts')
const { fetchBoundedJson } = require('../Back-End/electron/analysisNetwork.ts')
const { isDirectMedia } = require('../Back-End/electron/directAnalysis.ts')
const { normalizeAnalysisUrl, youtubeVideoId } = require('../Shared/analysisUrl.ts')
const { mediaOutputArgs, decideMediaConversion } = require('../Back-End/electron/mediaFormatRegistry.ts')
const tick = () => new Promise(resolve=>setImmediate(resolve))
const deferred = () => { let resolve,reject; const promise=new Promise((r,j)=>{resolve=r;reject=j}); return {promise,resolve,reject} }
async function sandbox(work) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-analysis-test-'))
  try { await work(dir) } finally { await fs.rm(dir,{recursive:true,force:true}) }
}
async function serve(handler, work) {
  const server=http.createServer(handler)
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try { await work(`http://127.0.0.1:${server.address().port}`) }
  finally { server.closeAllConnections(); await new Promise(r=>server.close(r)) }
}

test('analysis normalization preserves signed/authenticated identity and validates YouTube IDs', () => {
  const id='abcdefghijk'
  for(const url of [`https://youtu.be/${id}?si=share`,`https://youtube.com/watch?v=${id}`,`https://www.youtube.com/shorts/${id}`]) {
    assert.equal(youtubeVideoId(url),id)
    assert.equal(normalizeAnalysisUrl(` ${url} `),`https://www.youtube.com/watch?v=${id}`)
  }
  assert.equal(youtubeVideoId('https://youtube.com.evil.test/watch?v='+id),null)
  assert.equal(youtubeVideoId('https://youtu.be/invalid'),null)
  const signed='https://example.com/video/?token=secret&signature=value/'
  assert.equal(normalizeAnalysisUrl(signed),signed)
  assert.match(normalizeAnalysisUrl(`https://youtube.com/watch?v=${id}&list=PL123`),/list=PL123/)
})

test('analysis inflight dedup, independent cancellation, completed TTL/LRU cache and failures', async () => {
  let now=0, calls=0
  const coordinator=new AnalysisCoordinator(2,100,2,()=>now, value=>value.kind!=='unknown')
  const pending=deferred(), cancelled=new AbortController()
  const work=async()=>{calls++;return pending.promise}
  const first=coordinator.run('https://youtu.be/abcdefghijk',work,cancelled.signal)
  const rejected=assert.rejects(first,/abort/i)
  const second=coordinator.run('https://youtube.com/watch?v=abcdefghijk',work)
  await tick(); cancelled.abort(); await rejected
  pending.resolve({kind:'ytdlp',title:'correct',formats:[]})
  const result=await second
  assert.equal(calls,1)
  result.title='mutated'
  assert.equal((await coordinator.run('https://youtu.be/abcdefghijk',work)).title,'correct')
  now=101; await coordinator.run('https://youtu.be/abcdefghijk',work);assert.equal(calls,2)
  const unknown=async()=>{calls++;return {kind:'unknown'}}
  await coordinator.run('https://example.com/failure',unknown);await coordinator.run('https://example.com/failure',unknown)
  assert.equal(calls,4)
  await coordinator.run('https://example.com/b',async()=>({kind:'direct'}))
  await coordinator.run('https://example.com/c',async()=>({kind:'direct'}))
  await coordinator.run('https://youtu.be/abcdefghijk',work);assert.equal(calls,5)
})

test('batch analysis concurrency is bounded and queued cancellation releases ownership', async () => {
  const coordinator=new AnalysisCoordinator(3)
  let running=0, peak=0, calls=0
  const gate=deferred()
  const work=async()=>{calls++;peak=Math.max(peak,++running);await gate.promise;running--;return {kind:'direct'}}
  const jobs=Array.from({length:20},(_,i)=>coordinator.run(`https://example.com/${i}`,work))
  const controller=new AbortController()
  const queued=coordinator.run('https://example.com/cancel',work,controller.signal)
  const rejection=assert.rejects(queued,/abort/i)
  await tick();assert.equal(calls,3);controller.abort();await rejection
  gate.resolve();await Promise.all(jobs)
  assert.equal(peak,3);assert.equal(calls,20)
})

test('analysis owns real child teardown, deadlines, UTF-8 and output limits', async () => {
  const controller=new AbortController()
  const start=extractAnalysis(process.execPath,['-e','setInterval(()=>{},1000)'],controller.signal)
  const rejected=assert.rejects(start,/abort/i)
  controller.abort();await rejected
  await assert.rejects(extractAnalysis(process.execPath,['-e','process.stdout.write("x".repeat(2048));setInterval(()=>{},1000)'],new AbortController().signal,100),/size limit/)
  await assert.rejects(extractAnalysis(process.execPath,['-e','setInterval(()=>{},1000)'],new AbortController().signal,1024,30),/timed out/)
  const output=await extractAnalysis(process.execPath,['-e',"const b=Buffer.from('عنوان');for(let i=0;i<b.length;i++)process.stdout.write(b.subarray(i,i+1))"],new AbortController().signal)
  assert.equal(output,'عنوان')
})

test('last analysis consumer cancels its child before the next queued extraction starts', async () => {
  const coordinator=new AnalysisCoordinator(1)
  const controller=new AbortController(), started=deferred()
  let closed=false
  const first=coordinator.run('https://example.com/old',async(_url,signal)=>{
    started.resolve()
    try { return await extractAnalysis(process.execPath,['-e','setInterval(()=>{},1000)'],signal) }
    finally { closed=true }
  },controller.signal)
  const rejection=assert.rejects(first,/abort/i)
  await started.promise;controller.abort();await rejection
  await coordinator.run('https://example.com/new',async()=>{assert.equal(closed,true);return 'new'})
})

test('direct analysis uses HEAD and rejects webpage responses masquerading as media', async () => {
  const methods=[]
  await serve((req,res)=>{
    methods.push(req.method);res.setHeader('content-type',req.url==='/video.mp4'?'video/mp4':'text/html');res.end()
  },async base=>{
    assert.equal(await isDirectMedia(base+'/video.mp4',new AbortController().signal),true)
    assert.equal(await isDirectMedia(base+'/page.mp4',new AbortController().signal),false)
    assert.equal(await isDirectMedia(base+'/watch',new AbortController().signal),false)
    assert.deepEqual(methods,['HEAD','HEAD'])
  })
})

test('optional JSON request timeout includes stalled bodies and rejects oversized responses', async () => {
  await serve((req,res)=>{
    if(req.url==='/large'){res.end('x'.repeat(2*1024*1024+1));return}
    res.writeHead(200,{'content-type':'application/json'});res.write('{')
  },async base=>{
    await assert.rejects(fetchBoundedJson(base+'/slow',undefined,40),/timed out/)
    await assert.rejects(fetchBoundedJson(base+'/large'),/size limit/)
  })
})

test('thumbnail streams are bounded, typed, deduplicated, cached and partial files removed', async () => sandbox(async dir => {
  let requests=0
  await serve((req,res)=>{
    requests++
    if(req.url==='/html'){res.setHeader('content-type','text/html');res.end('bad');return}
    res.setHeader('content-type','image/png')
    if(req.url==='/large'){res.end(Buffer.alloc(8*1024*1024+1));return}
    if(req.url==='/advertised'){res.setHeader('content-length',8*1024*1024+1);res.end();return}
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64'))
  },async base=>{
    const cache=new ThumbnailCache(dir)
    const [a,b]=await Promise.all([cache.fetch(base+'/image'),cache.fetch(base+'/image')])
    assert.equal(a,b);assert.match(a,/[a-f0-9]{64}\.png$/);assert.equal(requests,1)
    assert.equal(await cache.fetch(base+'/image'),a);assert.equal(requests,1)
    await fs.writeFile(a,'corrupt cache');assert.equal(await cache.fetch(base+'/image'),a);assert.equal(requests,2)
    const legacy=path.join(dir,'A'.repeat(32)+'.jpg')
    await fs.writeFile(legacy,'old image');await fs.utimes(legacy,new Date(0),new Date(0))
    assert.equal(await new ThumbnailCache(dir).fetch(base+'/image'),a)
    await assert.rejects(fs.stat(legacy),/ENOENT/)
    for(const route of ['html','large','advertised']) await assert.rejects(cache.fetch(base+'/'+route),/thumbnail|size limit/)
    assert.equal((await fs.readdir(dir)).filter(file=>file.endsWith('.part')).length,0)
  })
}))

test('cookie validation caches metadata only and invalidates changes and deletion', async () => sandbox(async dir=>{
  const file=path.join(dir,'cookies.txt'),cache=new CookieValidationCache()
  await fs.writeFile(file,'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tname\tprivate')
  const first=await cache.validate(file);assert.equal(first.valid,true)
  first.valid=false;assert.equal((await cache.validate(file)).valid,true)
  await fs.writeFile(file,'invalid export changed size');assert.equal((await cache.validate(file)).code,'invalid_header')
  await fs.unlink(file);assert.equal((await cache.validate(file)).code,'missing')
}))

test('codec decisions preserve compatible streams and accurate trim encoding', () => {
  const source={format:{format_name:'matroska'},streams:[{codec_type:'video',codec_name:'h264'},{codec_type:'audio',codec_name:'aac'}]}
  assert.equal(decideMediaConversion('mp4',source),'remux')
  assert.ok(mediaOutputArgs('mp4','out',source).includes('copy'))
  assert.ok(!mediaOutputArgs('mp4','out',source).includes('libx264'))
  assert.equal(decideMediaConversion('m4a',source),'remux')
  const incompatibleAudio={...source,streams:[source.streams[0],{codec_type:'audio',codec_name:'opus'}]}
  const args=mediaOutputArgs('mp4','out',incompatibleAudio)
  assert.equal(decideMediaConversion('mp4',incompatibleAudio),'audio-encode')
  assert.equal(args[args.indexOf('-c:v')+1],'copy');assert.equal(args[args.indexOf('-c:a')+1],'aac')
  assert.ok(mediaOutputArgs('mp4','out',source,true).includes('libx264'))
})

test('renderer stale results, errors and enrichment cannot replace the active URL', async () => {
  global.localStorage={getItem:()=>null,setItem(){}}
  const pending=new Map(), listeners=new Set(), cancelled=[]
  global.window={cortexDl:{
    analyzeUrl(url,id){const work=deferred();pending.set(url,{...work,id});return work.promise},
    onAnalysisUpdate(fn){listeners.add(fn);return()=>listeners.delete(fn)},
    cancelAnalysis(id){cancelled.push(id);return Promise.resolve()}
  }}
  const {handleAnalyzeUrlDirectly}=require('../Front-End/src/actions/downloadActions.ts')
  const {useUIStore}=require('../Front-End/src/stores/useUIStore.ts')
  const a=handleAnalyzeUrlDirectly('https://youtu.be/abcdefghijk')
  assert.equal(useUIStore.getState().analyzeResult.preview,true)
  const old=pending.get('https://www.youtube.com/watch?v=abcdefghijk')
  const b=handleAnalyzeUrlDirectly('https://youtu.be/lmnopqrstuv')
  const latest=pending.get('https://www.youtube.com/watch?v=lmnopqrstuv')
  latest.resolve({kind:'ytdlp',title:'B',formats:[]});await b
  old.resolve({kind:'ytdlp',title:'A',formats:[]});await a
  for(const listener of listeners) listener({id:old.id,stage:'enrichment',data:{dislikes:999}})
  assert.equal(useUIStore.getState().analyzeResult.title,'B')
  assert.equal(useUIStore.getState().analyzeResult.dislikes,undefined)
  assert.ok(cancelled.includes(old.id))
  const c=handleAnalyzeUrlDirectly('https://example.com/c')
  const late=pending.get('https://example.com/c')
  const d=handleAnalyzeUrlDirectly('https://example.com/d')
  pending.get('https://example.com/d').resolve({kind:'ytdlp',title:'D',formats:[]});await d
  late.reject(new Error('late A failure'));await c
  assert.equal(useUIStore.getState().analyzeResult.title,'D');assert.equal(useUIStore.getState().globalError,null)
  useUIStore.getState().setUrl('');assert.equal(listeners.size,0);assert.equal(useUIStore.getState().analyzeResult,null)
  const preview=await fs.readFile(path.join(process.cwd(),'Front-End/src/components/AddDownloadTab/UrlAnalysisView.tsx'),'utf8')
  assert.match(preview,/loading="eager" fetchPriority="high" decoding="async"/)
})

test('IPC progressive analysis never waits for optional dislike service and playlist stays flat', async () => {
  fixture={id:'abcdefghijk',title:'fixture',duration:60,formats:[{format_id:'18',ext:'mp4',vcodec:'avc1',acodec:'mp4a',url:'https://signed.test/?expire=1',height:360}]}
  // Reload the extractor with a fake binary/process; no live provider is contacted.
  delete require.cache[require.resolve('../Back-End/electron/analysisProcess.ts')]
  delete require.cache[require.resolve('../Back-End/electron/ytdlp.ts')]
  const ytdlp=require('../Back-End/electron/ytdlp.ts')
  require('../Back-End/electron/ipc/handlers.ts').registerIpcHandlers({})
  const originalFetch=global.fetch
  global.fetch=(url,options)=>String(url).startsWith('https://www.youtube.com/oembed') ? Promise.resolve(new Response(JSON.stringify({title:'fast title'}))) : originalFetch(url,options)
  await serve((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{')},async base=>{
    process.env.RYD_API_URL=base+'/?videoId='
    const updates=[]
    const sender=new EventEmitter();sender.id=1;sender.isDestroyed=()=>false;sender.send=(_name,update)=>updates.push(update)
    const result=await handlers.get('cortexdl:analyze-url')({sender},'https://www.youtube.com/watch?v=abcdefghijk','session')
    assert.ok(updates.some(update=>update.stage==='preview' && update.data.title==='fast title'))
    assert.equal(result.title,'fixture');assert.equal(sender.listenerCount('destroyed'),1)
    const cached=await ytdlp.analyzeWithYtdlp('https://youtu.be/abcdefghijk')
    assert.equal(cached.formats[0].url,undefined);assert.equal(spawns.length,1)
    await handlers.get('cortexdl:cancel-analysis')({sender},'session')
    await tick();await tick()
    delete process.env.RYD_API_URL
  })
  global.fetch=originalFetch
  fixture={_type:'playlist',title:'list',entries:[{id:'abcdefghijk',title:'item',url:'abcdefghijk'}]}
  await ytdlp.analyzeWithYtdlp('https://youtube.com/playlist?list=PL123')
  assert.ok(spawns.at(-1).args.includes('--flat-playlist'))
  assert.ok(spawns.every(item=>!item.args.includes('--no-cache-dir')))
  assert.ok(spawns.every(item=>item.args.includes('--dump-single-json')))
  assert.ok(!binaryRequests.includes('ffmpeg'))
})
