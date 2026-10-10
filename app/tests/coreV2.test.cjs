require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const Module = require('node:module')
const cp = require('node:child_process')
const originalLoad = Module._load
const rows = new Map()
let notifications = 0
const mockDb = {
  db: { prepare: () => ({ get: () => undefined, run: () => {} }), transaction: fn => fn },
  taskDb: { getAllTasks: { all: () => [...rows.values()] }, upsertTask: { run: row => rows.set(row.id, { ...row }) }, deleteTask: { run: id => rows.delete(id) }, clearCompleted: { run: () => {} } },
}
Module._load = function(request, parent, ...rest) {
  if (request === './engineReadiness' || request === '../engineReadiness') return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
  if (request === './paths' || request === '../paths') return { getBinaryPath: name => path.join(process.cwd(), 'engine-baseline', name + '.exe'), getBinDirectory: () => path.join(process.cwd(), 'engine-baseline') }
  if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
  if (request === './db' || request === '../db') return mockDb
  if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() }, Notification: class { static isSupported() { return true } show() { notifications++ } } }
  return originalLoad.call(this, request, parent, ...rest)
}
const media = require('../Back-End/electron/mediaFiles.ts')
const { DownloadManager } = require('../Back-End/electron/downloadManager.ts')
const { DirectEngine } = require('../Back-End/electron/engines/DirectEngine.ts')
const { MediaFormatRegistry, matchesMediaFormat } = require('../Back-End/electron/mediaFormatRegistry.ts')
const { trimBounds } = require('../Back-End/electron/mediaPipeline.ts')
const { parseDownloadProgress } = require('../Back-End/electron/progressParser.ts')
const bin = name => path.join(process.cwd(), 'engine-baseline', name + (process.platform === 'win32' ? '.exe' : ''))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn) { for (let i = 0; i < 1000; i++) { if (fn()) return; await sleep(5) } throw new Error('condition timeout') }
function fixture(output, video = false, duration = 2) {
  const args = video ? ['-f','lavfi','-i',`testsrc2=size=64x64:rate=20:duration=${duration}`,'-f','lavfi','-i',`sine=duration=${duration}`,'-c:v','libx264','-c:a','aac'] : ['-f','lavfi','-i',`sine=duration=${duration}`,'-c:a','pcm_s16le']
  const result = cp.spawnSync(bin('ffmpeg'), ['-y','-hide_banner','-loglevel','error',...args,output], { timeout: 30000 })
  assert.equal(result.status, 0, result.stderr?.toString())
}
function item(directory, overrides = {}) { return { id: 'core-test', url: 'https://example.com/file', directory, filename: 'output.mp4', filePath: path.join(directory,'output.mp4'), engine:'direct', targetFormat:'mp4', status:'queued', totalBytes:null, downloadedBytes:0, speedBytesPerSec:null, errorMessage:null, createdAtMs:1, updatedAtMs:1, ...overrides } }
function managerFor(t) { rows.clear(); const manager = new DownloadManager(); manager.schedule = () => {}; manager.tasks.set(t.id,t); manager.runtime.set(t.id,manager.freshRuntime()); return manager }
async function sandbox(fn) { const dir = await fs.mkdtemp(path.join(os.tmpdir(),'cortex-v2-')); try { await fn(dir) } finally { await fs.rm(dir,{recursive:true,force:true}); rows.clear() } }
async function withCandidate(t, source, fn) {
  const original = DirectEngine.prototype.download
  DirectEngine.prototype.download = async draft => {
    const candidate = path.join(draft.directory,'source' + path.extname(source))
    await fs.copyFile(source,candidate)
    return {kind:'success', candidate}
  }
  const manager = managerFor(t)
  try { await fn(manager) } finally { DirectEngine.prototype.download = original; manager.flushPendingSave() }
}

test('fast Pause/Resume waits for a deliberately suspended old attempt; stale callbacks cannot mutate new state', async () => sandbox(async dir => {
  const original = DirectEngine.prototype.download
  const oldGate = deferred(), newGate = deferred(), started = deferred()
  let calls = 0, oldContext, oldDraft
  DirectEngine.prototype.download = async (draft, ctx) => {
    if (++calls === 1) { oldContext=ctx; oldDraft=draft; draft.downloadedBytes=1;ctx.sendUpdate(draft);started.resolve(); await oldGate.promise }
    else await newGate.promise
    return {kind:'paused'}
  }
  const t = item(dir), manager=managerFor(t)
  try {
    const running = manager.executeEngine(t.id); await started.promise
    const old=manager.attempts.get(t.id)
    const pausing = manager.pause(t.id)
    const resuming = manager.resume(t.id)
    await sleep(20)
    assert.equal(t.status,'pausing'); assert.equal(calls,1); assert.equal(manager.getActiveCount(),1)
    oldDraft.downloadedBytes=999; oldContext.sendUpdate(oldDraft)
    assert.equal(t.downloadedBytes,1)
    oldGate.resolve(); await Promise.all([running,pausing,resuming])
    const second=manager.executeEngine(t.id); await until(() => calls===2)
    const current=manager.attempts.get(t.id)
    assert.notEqual(current.attemptId,old.attemptId)
    assert.notEqual(current,old)
    const before=t.downloadedBytes
    oldDraft.downloadedBytes=888; oldDraft.status='completed'; oldContext.sendUpdate(oldDraft)
    assert.equal(t.downloadedBytes,before); assert.notEqual(t.status,'completed')
    assert.equal(manager.attempts.get(t.id),current)
    const canceled=manager.cancel(t.id); newGate.resolve(); await Promise.all([second,canceled])
    assert.equal(manager.active.size,0); assert.equal(manager.engines.size,0); assert.equal(manager.attempts.size,0)
    assert.equal(current.child,null); assert.equal(current.abortController,null)
    assert.equal(manager.writeBehindTimer,null);assert.equal(manager.dirtyIds.size,0)
  } finally { oldGate.resolve(); newGate.resolve(); DirectEngine.prototype.download=original; manager.flushPendingSave() }
}))

test('cancel at source probe, validation probe, promotion, and subtitle publication rolls back without Completed/stats/notification', async () => sandbox(async dir => {
  const source=path.join(dir,'source.mp4'); fixture(source,true)
  for (const point of ['probe1','probe2','promotion','subtitle']) {
    const t=item(dir,{id:point,filename:point+'.mp4',filePath:path.join(dir,point+'.mp4')})
    await withCandidate(t,source,async manager => {
      const probe=media.probeMediaFile, link=fs.link
      let probes=0, cancel
      const initialNotifications=notifications
      const events=[]
      manager.attachWindow({isDestroyed:()=>false,webContents:{send:(channel,data)=>events.push({channel,data:{...data}})}})
      media.probeMediaFile=async (...args) => { const result=await probe(...args); if (point===`probe${++probes}`) cancel=manager.cancel(t.id); return result }
      fs.link=async (from,to) => {
        await link(from,to)
        if (point==='promotion' && to.endsWith('.mp4')) cancel=manager.cancel(t.id)
        if (point==='subtitle' && to.endsWith('.srt')) cancel=manager.cancel(t.id)
      }
      const original=DirectEngine.prototype.download
      DirectEngine.prototype.download=async (...args) => { const result=await original(...args); await fs.writeFile(path.join(args[0].directory,t.id+'.en.srt'),'subtitle'); return result }
      try {
        await manager.executeEngine(t.id); await cancel
        assert.equal(t.status,'canceled',point)
        assert.equal(notifications,initialNotifications)
        assert.equal(events.filter(e=>e.channel.includes('stats')).length,0)
        assert.equal(events.filter(e=>e.data.status==='completed').length,0)
        assert.equal(await fs.stat(t.filePath).then(()=>true).catch(()=>false),false)
        assert.equal(manager.active.size,0)
      } finally { media.probeMediaFile=probe; fs.link=link; DirectEngine.prototype.download=original }
    })
  }
}))

test('real media conversion validates all registry formats; only manager commits and emits success once', async () => sandbox(async dir => {
  const audio=path.join(dir,'source.wav'), video=path.join(dir,'source.mp4')
  fixture(audio); fixture(video,true)
  for (const [format,spec] of Object.entries(MediaFormatRegistry)) {
    const t=item(dir,{id:format,targetFormat:format,filename:'output.'+format,filePath:path.join(dir,'output.'+format)})
    await withCandidate(t,spec.videoCodec ? video : audio,async manager => {
      const events=[]; const before=notifications
      manager.attachWindow({isDestroyed:()=>false,webContents:{send:(channel,data)=>events.push({channel,data:{...data}})}})
      await manager.executeEngine(t.id)
      assert.equal(t.status,'completed',format+': '+t.errorMessage)
      assert.equal(t.overallProgress,100)
      assert.equal(matchesMediaFormat(format,await media.probeMediaFile(t.filePath)),true,format)
      assert.equal(events.filter(e=>e.channel.includes('stats')).length,1)
      assert.equal(notifications,before+1)
      assert.equal(manager.attempts.size,0)
      assert.equal(manager.runtime.get(t.id).child,null)
      assert.equal(manager.runtime.get(t.id).abortController,null)
    })
  }
  assert.equal(matchesMediaFormat('aac',await media.probeMediaFile(path.join(dir,'output.m4a'))),false)
}))

test('real video/audio trimming supports start only, end only, both, with verified output duration', async () => sandbox(async dir => {
  for (const video of [false,true]) {
    const source=path.join(dir,video?'source.mp4':'source.wav'); fixture(source,video,3)
    for (const [startTime,endTime,expected] of [['1',undefined,2],[undefined,'1',1],['1','2',1]]) {
      const format=video?'mp4':'mp3'; const id=`trim-${video}-${startTime}-${endTime}`
      const t=item(dir,{id,targetFormat:format,filename:id+'.'+format,filePath:path.join(dir,id+'.'+format),startTime,endTime})
      await withCandidate(t,source,async manager => {
        const phases=[]; manager.attachWindow({isDestroyed:()=>false,webContents:{send:(_channel,data)=>phases.push(data.phase)}})
        await manager.executeEngine(t.id)
        assert.equal(t.status,'completed',t.errorMessage)
        assert.ok(phases.includes('trimming'))
        const probe=await media.probeMediaFile(t.filePath)
        assert.ok(Math.abs(Number(probe.format.duration)-expected)<0.25)
      })
    }
  }
  assert.throws(()=>trimBounds({startTime:'2',endTime:'1'}),/greater/)
  assert.throws(()=>trimBounds({startTime:'1:99'}),/Invalid/)
}))

test('Pause/Cancel during real FFmpeg conversion and trimming kills process, releases resources, and resume recreates output', async () => sandbox(async dir => {
  const source=path.join(dir,'source.mp4'); fixture(source,true,3)
  for (const phase of ['conversion','trimming']) for (const action of ['pause','cancel']) {
    const id=`${phase}-${action}`, t=item(dir,{id,targetFormat:'webm',filename:id+'.webm',filePath:path.join(dir,id+'.webm'),...(phase==='trimming'?{startTime:'1',endTime:'2'}:{})})
    await withCandidate(t,source,async manager => {
      const spawn=cp.spawn; let stopped,pid
      cp.spawn=(binary,args,options) => {
        const child=spawn(binary,args.includes('-nostdin')?args.flatMap(arg=>arg==='-i'?['-re','-i']:[arg]):args,options)
        if (args.includes('-nostdin') && !stopped) {
          pid=child.pid
          setTimeout(()=>{ stopped=manager[action](t.id) },50)
        }
        return child
      }
      try { await manager.executeEngine(t.id); await stopped } finally { cp.spawn=spawn }
      assert.equal(t.status,action==='pause'?'paused':'canceled')
      assert.throws(()=>process.kill(pid,0))
      assert.equal(manager.active.size,0); assert.equal(manager.attempts.size,0)
      assert.equal(manager.runtime.get(t.id).child,null)
      assert.equal(await fs.stat(t.filePath).then(()=>true).catch(()=>false),false)
      if (action==='pause') {
        await manager.resume(t.id); await manager.executeEngine(t.id)
        assert.equal(t.status,'completed',t.errorMessage)
        assert.ok(matchesMediaFormat('webm',await media.probeMediaFile(t.filePath)))
      }
    })
  }
}))

test('corrupt media never becomes Completed; deleting respects final ownership and unrelated files', async () => sandbox(async dir => {
  const corrupt=path.join(dir,'corrupt.mp4'); await fs.writeFile(corrupt,'not media')
  const t=item(dir)
  await withCandidate(t,corrupt,async manager => {
    await manager.executeEngine(t.id); assert.equal(t.status,'error')
    assert.equal(await fs.stat(t.filePath).then(()=>true).catch(()=>false),false)
    const unrelated=path.join(dir,'unrelated.mp4'); await fs.writeFile(unrelated,'keep')
    t.filePath=unrelated
    await manager.delete(t.id,true)
    assert.equal(await fs.readFile(unrelated,'utf8'),'keep')
  })
  const source=path.join(dir,'source.mp4'); fixture(source,true)
  for (const deleteFile of [false,true]) {
    const t=item(dir,{id:'delete-'+deleteFile})
    await withCandidate(t,source,async manager=>{
      await manager.executeEngine(t.id); assert.equal(t.status,'completed')
      const final=t.filePath
      await manager.delete(t.id,deleteFile)
      assert.equal(await fs.stat(final).then(()=>true).catch(()=>false),!deleteFile)
    })
  }
}))

test('successful download removes its entire temp tree while preserving another paused download', async () => sandbox(async dir => {
  const source = path.join(dir, 'source.mp4'); fixture(source, true)
  const paused = path.join(dir, '.cortex_temp', 'paused-task', 'attempt', 'partial.part')
  await fs.mkdir(path.dirname(paused), { recursive: true }); await fs.writeFile(paused, 'resume me')
  const t = item(dir)
  await withCandidate(t, source, async manager => {
    await manager.executeEngine(t.id)
    assert.equal(t.status, 'completed', t.errorMessage)
    assert.equal(await fs.stat(path.join(dir, '.cortex_temp', t.id)).then(() => true, () => false), false)
    assert.equal(await fs.readFile(paused, 'utf8'), 'resume me')
    assert.ok((await fs.stat(t.filePath)).size > 0)
    await manager.removeTaskFragments(item(dir, { id: 'paused-task' }))
    assert.equal(await fs.stat(path.join(dir, '.cortex_temp')).then(() => true, () => false), false)
    assert.ok((await fs.stat(t.filePath)).size > 0)
  })
}))

test('startup cleans completed and canceled leftovers, preserving paused/error partials and final files', async () => sandbox(async dir => {
  const final = path.join(dir, 'completed.mp4'); await fs.writeFile(final, 'final output')
  for (const status of ['completed', 'canceled', 'paused', 'error']) {
    const partial = path.join(dir, '.cortex_temp', status, 'old-attempt', 'partial.part')
    await fs.mkdir(path.dirname(partial), { recursive: true }); await fs.writeFile(partial, status)
    const t = item(dir, { id: status, status, filePath: final, validatedAttemptId: 'validated' })
    rows.set(t.id, { full_payload: JSON.stringify(t) })
  }
  const manager = new DownloadManager()
  await manager.cleanupSettledFragments()
  for (const status of ['completed', 'canceled', 'paused', 'error']) {
    assert.equal(await fs.stat(path.join(dir, '.cortex_temp', status)).then(() => true, () => false), ['paused', 'error'].includes(status))
  }
  assert.equal(await fs.readFile(final, 'utf8'), 'final output')
  assert.equal(manager.list().length, 4)
  manager.flushPendingSave()
}))

test('temp cleanup rejects traversal and a redirected temp root', async () => sandbox(async dir => {
  const manager = managerFor(item(dir))
  const sentinel = path.join(dir, 'keep'); await fs.writeFile(sentinel, 'keep')
  await manager.removeTaskFragments(item(dir, { id: '../' }))
  await manager.removeTaskFragments(item('', { id: 'core-test' }))
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep')
  const outside = path.join(dir, 'unrelated'); await fs.mkdir(outside)
  const saved = path.join(outside, 'core-test', 'data'); await fs.mkdir(path.dirname(saved)); await fs.writeFile(saved, 'keep')
  await fs.symlink(outside, path.join(dir, '.cortex_temp'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(manager.removeTaskFragments(item(dir)), /Unsafe temp root/)
  assert.equal(await fs.readFile(saved, 'utf8'), 'keep')
  manager.flushPendingSave()
}))

test('retry backoff releases concurrency slot and uses fresh attempt; deletion cannot resurrect it', async () => sandbox(async dir => {
  const original=DirectEngine.prototype.download
  DirectEngine.prototype.download=async()=>({kind:'retryable-error',message:'retry',delayMs:10000})
  const t=item(dir),manager=managerFor(t)
  try {
    await manager.executeEngine(t.id)
    assert.equal(t.status,'queued'); assert.equal(manager.active.size,0)
    assert.equal(manager.retryTimers.size,1); assert.equal(manager.attempts.size,0)
    await manager.delete(t.id,false)
    assert.equal(manager.retryTimers.size,0); assert.equal(manager.tasks.size,0)
  } finally { DirectEngine.prototype.download=original; manager.flushPendingSave() }
}))

test('recovery never certifies partial output; pausing/queued/processing states become paused', async () => sandbox(async dir => {
  for (const status of ['queued','pausing','downloading','merging','converting']) {
    const t=item(dir,{status,id:status,downloadedBytes:100,totalBytes:100})
    rows.set(t.id,{full_payload:JSON.stringify(t)})
  }
  const manager=new DownloadManager()
  for (const t of manager.list()) { assert.equal(t.status,'paused'); assert.notEqual(t.overallProgress,100) }
  manager.flushPendingSave()
}))

test('yt-dlp repeated video/audio stream snapshots never double count bytes', () => {
  const t=item('',{engine:'ytdlp',ytdlpExpectedBytes:200})
  for (let i=0;i<10;i++) {
    parseDownloadProgress('CORTEX_DL|video|v.part|100|100|10',t)
    parseDownloadProgress('CORTEX_DL|audio|a.part|50|100|10',t)
  }
  assert.equal(t.downloadedBytes,150)
  assert.equal(t.totalBytes,200)
})

test('Direct resume revalidates changed ETag or Last-Modified, sends If-Range, and never mixes versions', async () => sandbox(async dir => {
  for (const validator of ['etag','last-modified']) for (const change of [false,true]) {
    let version=1, ifRanges=[]
    const body=()=>Buffer.alloc(5*1024*1024+100,version)
    const header=()=>validator==='etag'?`"v${version}"`:`Mon, 0${version} Jun 2026 00:00:00 GMT`
    const server=http.createServer((req,res)=>{
      const data=body()
      if(req.method==='HEAD'){res.writeHead(200,{'content-length':data.length,'accept-ranges':'bytes',[validator]:header()});return res.end()}
      const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'')
      if(req.headers['if-range']) ifRanges.push(req.headers['if-range'])
      const start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):data.length-1
      res.writeHead(range?206:200,{'content-length':end-start+1,[validator]:header(),...(range?{'content-range':`bytes ${start}-${end}/${data.length}`}:{})})
      let pos=start;const timer=setInterval(()=>{if(res.destroyed)return clearInterval(timer);const next=data.subarray(pos,Math.min(end+1,pos+8192));pos+=next.length;res.write(next);if(pos>end){clearInterval(timer);res.end()}},2)
    })
    await new Promise(r=>server.listen(0,'127.0.0.1',r))
    try {
      const t=item(dir,{url:`http://127.0.0.1:${server.address().port}/file`,filePath:path.join(dir,`${validator}-${change}.bin`),status:'downloading'})
      const ctx={runtime:{abortController:new AbortController(),retries:0},sendUpdate(){},saveState(){}}
      const engine=new DirectEngine(),running=engine.download(t,ctx)
      await until(()=>t.downloadedBytes>65536)
      engine.pause();assert.equal((await running).kind,'paused')
      if(change)version=2
      const result=await new DirectEngine().download(t,{...ctx,runtime:{abortController:new AbortController(),retries:0}})
      assert.equal(result.kind,'success');assert.deepEqual(await fs.readFile(t.filePath),body())
      assert.ok(ifRanges.includes(header()))
    } finally {server.closeAllConnections();await new Promise(r=>server.close(r))}
  }
}))


test('real SQLite WAL crash/restart recovery runs under the bundled Electron native ABI', async () => sandbox(async dir => {
  const electron=path.join(process.cwd(),'node_modules','electron','dist','electron'+(process.platform==='win32'?'.exe':''))
  const worker=path.join(__dirname,'fixtures','sqliteRecovery.cjs')
  await fs.writeFile(path.join(dir,'partial.mp4'),'corrupt partial')
  for(const mode of ['seed','recover']) {
    const result=cp.spawnSync(electron,[worker,mode,dir],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,windowsHide:true})
    assert.equal(result.status,0,result.stdout?.toString()+result.stderr?.toString())
  }
}))


test('Pause/Cancel during real merge stops FFmpeg and cannot approve its partial candidate', async () => sandbox(async dir => {
  const video=path.join(dir,'source.mp4'),audio=path.join(dir,'audio.wav')
  fixture(video,true,3);fixture(audio,false,3)
  const {runMediaProcess}=require('../Back-End/electron/mediaPipeline.ts')
  for(const action of ['pause','cancel']) {
    const t=item(dir,{id:'merge-'+action}),manager=managerFor(t)
    const original=DirectEngine.prototype.download
    let stopped,pid
    DirectEngine.prototype.download=async(draft,ctx)=>{
      draft.status='merging';ctx.sendUpdate(draft)
      const running=runMediaProcess(['-re','-i',video,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac',draft.filePath],draft,ctx)
      await until(() => ctx.runtime.child)
      pid=ctx.runtime.child.pid
      setTimeout(()=>{stopped=manager[action](t.id)},50)
      await running
      return {kind:'success',candidate:draft.filePath}
    }
    try {
      await manager.executeEngine(t.id);await stopped
      assert.equal(t.status,action==='pause'?'paused':'canceled')
      assert.throws(()=>process.kill(pid,0))
      assert.equal(manager.active.size,0);assert.equal(manager.attempts.size,0)
      assert.equal(await fs.stat(t.filePath).then(()=>true).catch(()=>false),false)
    } finally {DirectEngine.prototype.download=original;manager.flushPendingSave()}
  }
}))

test('active delete awaits attempt settlement and stale success cannot recreate a deleted task', async () => sandbox(async dir => {
  const gate=deferred(),started=deferred(),original=DirectEngine.prototype.download
  let draft,context
  DirectEngine.prototype.download=async(t,ctx)=>{draft=t;context=ctx;started.resolve();await gate.promise;return {kind:'success',candidate:t.filePath}}
  const t=item(dir),manager=managerFor(t)
  try {
    const execution=manager.executeEngine(t.id);await started.promise
    const deleting=manager.delete(t.id,false)
    await sleep(15);assert.equal(manager.active.size,1)
    gate.resolve();await Promise.all([execution,deleting])
    draft.status='completed';context.sendUpdate(draft)
    assert.equal(manager.tasks.size,0);assert.equal(manager.active.size,0);assert.equal(manager.engines.size,0)
    assert.equal(rows.has(t.id),false)
  } finally {gate.resolve();DirectEngine.prototype.download=original;manager.flushPendingSave()}
}))

test('atomic publication refuses an unrelated destination created during finalization', async () => sandbox(async dir => {
  const source=path.join(dir,'source.mp4');fixture(source,true)
  const t=item(dir)
  await withCandidate(t,source,async manager=>{
    const link=fs.link
    fs.link=async(from,to)=>{await fs.writeFile(to,'unrelated');return link(from,to)}
    try {await manager.executeEngine(t.id)} finally {fs.link=link}
    assert.equal(t.status,'error')
    assert.equal(await fs.readFile(t.filePath,'utf8'),'unrelated')
    await manager.delete(t.id,true)
    assert.equal(await fs.readFile(t.filePath,'utf8'),'unrelated')
  })
}))

test('manager Direct Range resume transfers scoped files only after pause settlement, then validates final media', async () => sandbox(async dir => {
  const source=path.join(dir,'source.wav');fixture(source,false,70)
  const body=await fs.readFile(source)
  assert.ok(body.length>5*1024*1024)
  const sockets=new Set(),requests=[]
  const server=http.createServer((req,res)=>{
    if(req.method==='HEAD'){res.writeHead(200,{'content-length':body.length,'accept-ranges':'bytes',etag:'"stable"'});return res.end()}
    requests.push(req.headers.range)
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'')
    const start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):body.length-1
    res.writeHead(range?206:200,{'content-length':end-start+1,etag:'"stable"',...(range?{'content-range':`bytes ${start}-${end}/${body.length}`}:{})})
    let offset=start;const timer=setInterval(()=>{if(res.destroyed)return clearInterval(timer);const piece=body.subarray(offset,Math.min(end+1,offset+8192));offset+=piece.length;res.write(piece);if(offset>end){clearInterval(timer);res.end()}},5)
  })
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const t=item(dir,{url:`http://127.0.0.1:${server.address().port}/audio`,targetFormat:'wav',filename:'final.wav',filePath:path.join(dir,'final.wav')})
  const manager=managerFor(t)
  try {
    const first=manager.executeEngine(t.id)
    await until(()=>t.downloadedBytes>65536)
    const oldId=t.attemptId,oldDir=manager.attempts.get(t.id).directory
    await manager.pause(t.id);await first
    assert.equal(t.status,'paused');assert.ok(t.resumeChunks.length)
    assert.ok(oldDir.endsWith(oldId));assert.equal(t.resumeDirectory,oldDir)
    const pausedBytes=t.downloadedBytes
    await manager.resume(t.id);await manager.executeEngine(t.id)
    assert.notEqual(t.attemptId,oldId)
    assert.equal(t.status,'completed',t.errorMessage)
    assert.ok(pausedBytes>0)
    assert.ok(requests.length>8)
    assert.deepEqual(await fs.readFile(t.filePath),body)
    assert.equal(await fs.stat(oldDir).then(()=>true).catch(()=>false),false)
    assert.equal(manager.active.size,0)
    await until(()=>sockets.size===0) // no forced server shutdown may hide pooled socket leaks
  } finally {manager.flushPendingSave();server.closeAllConnections();await new Promise(r=>server.close(r));await until(()=>sockets.size===0)}
}))


test('real YoutubeEngine success and Pause/Cancel retire yt-dlp metadata and download processes', async () => sandbox(async dir => {
  const source=path.join(dir,'clip.mp4');fixture(source,true,3)
  const body=await fs.readFile(source)
  const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'video/mp4','content-length':body.length});res.end(req.method==='HEAD'?undefined:body)})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try {
    for(const action of ['success','pause','cancel']) {
      const t=item(dir,{id:'youtube-'+action,engine:'ytdlp',url:`http://127.0.0.1:${server.address().port}/clip.mp4`}),manager=managerFor(t)
      const spawn=cp.spawn,children=[];let stopped
      cp.spawn=(binary,args,opts)=>{
        const child=spawn(binary,args,opts);children.push(child)
        if(action!=='success'&&binary.includes('yt-dlp')&&args.includes('-o')) setTimeout(()=>{stopped=manager[action](t.id)},40)
        return child
      }
      try {await manager.executeEngine(t.id);await stopped} finally {cp.spawn=spawn}
      assert.equal(t.status,action==='success'?'completed':action==='pause'?'paused':'canceled',t.errorMessage)
      assert.equal(manager.active.size,0);assert.equal(manager.attempts.size,0)
      assert.equal(manager.runtime.get(t.id).child,null)
      assert.equal(manager.runtime.get(t.id).abortController,null)
      for(const child of children) if(child.pid) assert.throws(()=>process.kill(child.pid,0))
      manager.flushPendingSave()
    }
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r))}
}))

test('MP4 remux retains embedded subtitles and metadata through the shared registry', async () => sandbox(async dir => {
  const video=path.join(dir,'clip.mp4'),subtitle=path.join(dir,'sub.srt'),source=path.join(dir,'source.mkv')
  fixture(video,true,2);await fs.writeFile(subtitle,'1\n00:00:00,000 --> 00:00:01,500\nCortex subtitle\n')
  const result=cp.spawnSync(bin('ffmpeg'),['-y','-hide_banner','-loglevel','error','-i',video,'-i',subtitle,'-map','0:v','-map','0:a','-map','1:s','-c','copy','-metadata','title=Subtitle regression',source],{timeout:30000})
  assert.equal(result.status,0,result.stderr?.toString())
  const t=item(dir)
  await withCandidate(t,source,async manager=>{
    await manager.executeEngine(t.id)
    assert.equal(t.status,'completed',t.errorMessage)
    const probe=await media.probeMediaFile(t.filePath)
    assert.ok(probe.streams.some(stream=>stream.codec_type==='subtitle'&&stream.codec_name==='mov_text'))
  })
}))

test('manager refuses Completed when a requested YouTube subtitle stream is missing', async () => sandbox(async dir => {
  const { YoutubeEngine } = require('../Back-End/electron/engines/YoutubeEngine.ts')
  const source = path.join(dir, 'source.mp4'); fixture(source, true, 1)
  const original = YoutubeEngine.prototype.download
  YoutubeEngine.prototype.download = async draft => {
    const candidate = path.join(draft.directory, 'source.mp4')
    await fs.copyFile(source, candidate)
    return { kind: 'success', candidate }
  }
  const t = item(dir, { engine: 'ytdlp', subtitleLanguage: 'ar' }), manager = managerFor(t)
  try {
    await manager.executeEngine(t.id)
    assert.equal(t.status, 'error')
    assert.equal(t.errorMessage, 'YOUTUBE_SUBTITLE_UNAVAILABLE')
    assert.equal(await fs.stat(t.filePath).then(() => true).catch(() => false), false)
  } finally { YoutubeEngine.prototype.download = original; manager.flushPendingSave() }
}))


test('decodable headers cannot certify a corrupt media payload', async () => sandbox(async dir => {
  const source=path.join(dir,'source.wav');fixture(source,false,2)
  const bytes=await fs.readFile(source)
  const truncated=path.join(dir,'truncated.wav');await fs.writeFile(truncated,bytes.subarray(0,bytes.length-1))
  assert.ok(matchesMediaFormat('wav',await media.probeMediaFile(truncated)), 'header probe alone still recognizes the format')
  const t=item(dir,{targetFormat:'wav',filename:'final.wav',filePath:path.join(dir,'final.wav')})
  await withCandidate(t,truncated,async manager=>{
    await manager.executeEngine(t.id)
    assert.equal(t.status,'error')
    assert.match(t.errorMessage,/FFmpeg/)
    assert.equal(await fs.stat(t.filePath).then(()=>true).catch(()=>false),false)
  })
}))

test('modern YouTube VP9 video keeps identical packets when finalized as MP4', async () => sandbox(async dir => {
  const source=path.join(dir,'source.webm')
  const created=cp.spawnSync(bin('ffmpeg'),['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x64:rate=20:duration=6','-f','lavfi','-i','sine=duration=6','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','5','-threads','2','-c:a','libopus',source],{timeout:30000})
  assert.equal(created.status,0,created.stderr?.toString())
  const t=item(dir)
  await withCandidate(t,source,async manager=>{
    await manager.executeEngine(t.id)
    assert.equal(t.status,'completed',t.errorMessage)
    const probe=await media.probeMediaFile(t.filePath)
    assert.equal(probe.streams.find(s=>s.codec_type==='video').codec_name,'vp9')
    assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac')
    const packetHashes=file=>{
      const result=cp.spawnSync(bin('ffprobe'),['-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','json',file],{encoding:'utf8',timeout:15000})
      assert.equal(result.status,0,result.stderr)
      return JSON.parse(result.stdout).packets.map(packet=>packet.data_hash)
    }
    assert.deepEqual(packetHashes(t.filePath),packetHashes(source),'video data is copied without re-encoding')
  })
}))


test('concurrent process-tree cleanup shares one teardown promise and leaves no process', async () => {
  const {killProcessTree}=require('../Back-End/electron/utils.ts')
  const child=cp.spawn(bin('ffmpeg'),['-nostdin','-hide_banner','-loglevel','error','-re','-f','lavfi','-i','sine=duration=20','-f','null','-'],{windowsHide:true,detached:process.platform!=='win32'})
  child.stdout.resume();child.stderr.resume()
  const closed=new Promise(resolve=>child.on('close',resolve))
  const startedAt=Date.now()
  const first=killProcessTree(child),second=killProcessTree(child)
  assert.equal(first,second)
  await Promise.all([first,second,closed])
  assert.ok(Date.now()-startedAt<8000,'cleanup must terminate the child, not wait for its 20-second natural exit')
  assert.throws(()=>process.kill(child.pid,0))
})
