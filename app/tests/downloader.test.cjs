const { suite } = require('./register-ts.cjs')

suite('Download attempts', test => {
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
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
    if (request === './paths' || request === '../paths') return { getBinaryPath: name => path.join(process.cwd(), 'engine-baseline', name + '.exe'), getBinDirectory: () => path.join(process.cwd(), 'engine-baseline') }
    if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
    if (request === './db' || request === '../db') return mockDb
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() }, Notification: class { static isSupported() { return true } show() { notifications++ } } }
    return originalLoad.call(this, request, parent, ...rest)
  }
  const media = require('../Back-End/electron/services/mediaService.ts')
  const { DownloadManager } = require('../Back-End/electron/downloadManager.ts')
  const { DirectEngine } = require('../Back-End/electron/engines/DirectEngine.ts')
  const { MediaFormatRegistry, matchesMediaFormat, trimBounds } = require('../Back-End/electron/services/mediaService.ts')

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
    const {runMediaProcess}=require('../Back-End/electron/services/mediaService.ts')
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
      await until(()=>sockets.size===0)
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

  test('manager completes ordinary video downloads despite retired online-caption options in a legacy task', async () => sandbox(async dir => {
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
      assert.equal(t.status, 'completed', t.errorMessage)
      assert.equal(await fs.stat(t.filePath).then(() => true).catch(() => false), true)
    } finally { YoutubeEngine.prototype.download = original; manager.flushPendingSave() }
  }))

  test('manager restores failed download history and preserves source paths and error details', () => {
    rows.clear()
    const saved = item(os.tmpdir(), { engine: 'ytdlp', status: 'error', errorMessage: 'YOUTUBE_AUTH_REQUIRED' })
    rows.set(saved.id, { full_payload: JSON.stringify(saved) })
    const manager = new DownloadManager(), restored = manager.get(saved.id)
    assert.equal(restored.errorMessage, saved.errorMessage)
    assert.equal(restored.filePath, saved.filePath)
    assert.equal(restored.url, saved.url)
    assert.equal(restored.status, 'error')
    const persisted = JSON.parse(rows.get(saved.id).full_payload)
    assert.equal(persisted.filePath, saved.filePath)
    assert.equal(persisted.errorMessage, saved.errorMessage)
    manager.flushPendingSave(); rows.clear()
  })

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
})

suite('Download history', test => {
  const assert = require('node:assert/strict')
  const Module = require('node:module')
  const load = Module._load
  Module._load = function(request, parent, ...rest) {
    if (request === '../hooks/useHighFrequencyIPC') return { startHighFrequencyIPCListeners: () => () => {} }
    return load.call(this, request, parent, ...rest)
  }
  const { initDownloadStore, useDownloadStore } = require('../Front-End/src/stores/downloadStore.ts')
  const tick = () => new Promise(resolve => setImmediate(resolve))

  test('history retries after failed startup when engines become ready; completed items reappear', async () => {
    const listeners = new Set(), errors = [], error = console.error
    let calls = 0
    const saved = { id: 'completed', status: 'completed', title: 'Saved download' }
    global.window = { cortexDl: {
      listDownloads: async () => { if (++calls === 1) throw new Error('startup delayed'); return [saved] },
      onSetupProgress: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    } }
    console.error = (...args) => errors.push(args)
    useDownloadStore.getState().loadTasks([])
    const dispose = initDownloadStore()
    try {
      await tick()
      assert.equal(errors.length, 1)
      for (const listener of listeners) listener({ status: 'checking' })
      assert.equal(calls, 1)
      for (const listener of listeners) listener({ status: 'ready' })
      await tick()
      assert.deepEqual(useDownloadStore.getState().tasks.get(saved.id), saved)
      assert.equal(calls, 2)
    } finally { dispose(); console.error = error }
    assert.equal(listeners.size, 0)
  })

  test('ready during a failing initial request still retries, and disposed requests cannot restore stale tasks', async () => {
    let rejectInitial, resolveRefresh, readyListener, calls = 0
    global.window = { cortexDl: {
      listDownloads: () => ++calls === 1 ? new Promise((_, reject) => { rejectInitial = reject }) : new Promise(resolve => { resolveRefresh = resolve }),
      onSetupProgress: listener => { readyListener = listener; return () => {} },
    } }
    const error = console.error
    console.error = () => {}
    useDownloadStore.getState().loadTasks([])
    const dispose = initDownloadStore()
    try {
      readyListener({ status: 'ready' })
      rejectInitial(new Error('timeout'))
      await tick()
      assert.equal(calls, 2)
      dispose()
      resolveRefresh([{ id: 'stale', status: 'completed' }])
      await tick()
      assert.equal(useDownloadStore.getState().tasks.size, 0)
    } finally { dispose(); console.error = error }
  })
})

suite('Quality selection', test => {
  const assert = require('node:assert/strict')
  global.localStorage = { getItem: () => null, setItem() {} }
  const { useUIStore } = require('../Front-End/src/stores/useUIStore.ts')
  const { useFormStore } = require('../Front-End/src/stores/useFormStore.ts')
  const { handleAnalyzeUrlDirectly, onDownloadNow } = require('../Front-End/src/actions/downloadActions.ts')
  const { primaryAnalysis } = require('../Front-End/src/lib/analysisSession.ts')
  const result = { kind: 'ytdlp', title: '4K video', thumbnail: 'https://fixture.invalid/thumbnail',
    formats: [144, 360, 720, 1080, 1440, 2160].map(height => ({ formatId: String(height), height, fps: 24 })) }
  function prepare(analyzeUrl) {
    primaryAnalysis.cancel()
    useUIStore.setState({ url: '', analyzing: false, analyzeResult: null, directory: 'C:\\Downloads', showToast() {} })
    useFormStore.setState({ selectedQuality: '720p', selectedYtdlpFormatId: '720p' })
    global.window = { cortexDl: { analyzeUrl, onAnalysisUpdate: () => () => {}, cancelAnalysis: async () => {} } }
  }

  test('new video analysis clears the previous low quality and downloads with best auto', async () => {
    prepare(async () => structuredClone(result))
    let input
    window.cortexDl.addDownload = async value => { input = value }
    await handleAnalyzeUrlDirectly('https://youtube.com/watch?v=abcdefghijk')
    assert.equal(useFormStore.getState().selectedQuality, '')
    assert.equal(useFormStore.getState().selectedYtdlpFormatId, null)
    await onDownloadNow()
    assert.equal(input.ytdlpFormatId, undefined, 'previous 720p must not limit the new video')
  })

  test('a quality chosen during analysis remains selected when full formats arrive', async () => {
    let finish
    prepare(() => new Promise(resolve => { finish = resolve }))
    const analysis = handleAnalyzeUrlDirectly('https://youtube.com/watch?v=abcdefghijk')
    useFormStore.setState({ selectedQuality: '1080p', selectedYtdlpFormatId: '1080p' })
    finish(structuredClone(result))
    await analysis
    assert.equal(useFormStore.getState().selectedQuality, '1080p')
    assert.equal(useFormStore.getState().selectedYtdlpFormatId, '1080p')
  })

  test('ordinary video downloads and batch items do not request online captions', async () => {
    prepare(async () => ({ ...structuredClone(result), subtitles: [{ languageCode: 'ar', isAutomatic: true }] }))
    await handleAnalyzeUrlDirectly('https://youtube.com/watch?v=abcdefghijk')
    useFormStore.setState({ targetFormat: 'mp4' })
    let input
    window.cortexDl.addDownload = async value => { input = value }
    await onDownloadNow()
    assert.equal(Object.hasOwn(input, 'subtitleLanguage'), false)
    assert.equal(Object.hasOwn(input, 'subtitleIsAutomatic'), false)
    await handleAnalyzeUrlDirectly('https://youtube.com/watch?v=abcdefghijk')
    const { onAddToList, onStartBatchDownload } = require('../Front-End/src/actions/downloadActions.ts')
    onAddToList()
    const item = useUIStore.getState().batchItems[0]
    assert.equal(Object.hasOwn(item, 'subtitleLanguage'), false)
    let batch
    window.cortexDl.addBatchDownloads = async values => { batch = values; return [] }
    await onStartBatchDownload()
    assert.equal(Object.hasOwn(batch[0], 'subtitleLanguage'), false)
    assert.equal(Object.hasOwn(batch[0], 'subtitleIsAutomatic'), false)
  })
})

suite('Download recovery', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const os = require('node:os')
  const path = require('node:path')
  const http = require('node:http')
  const Module = require('node:module')
  const { EventEmitter } = require('node:events')
  const { spawnSync } = require('node:child_process')
  const { existsSync } = require('node:fs')
  const originalLoad = Module._load
  const dbMock = {
    db: { prepare: () => ({ get: () => undefined, run: () => {} }), transaction: fn => fn },
    taskDb: { getAllTasks: { all: () => [] }, upsertTask: { run: row => { dbMock.lastRow = row } }, deleteTask: { run: () => {} }, clearCompleted: { run: () => {} } },
  }
  Module._load = function (request, parent, ...rest) {
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
    if (request === './paths' || request === '../paths') return { getBinaryPath: name => path.join(process.cwd(), 'engine-baseline', name + '.exe'), getBinDirectory: () => path.join(process.cwd(), 'engine-baseline') }
    if (request === 'electron-log') return { info: () => {}, warn: () => {}, error: () => {} }
    if (request === './db' || request === '../db') return dbMock
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() }, Notification: { isSupported: () => false } }
    return originalLoad.call(this, request, parent, ...rest)
  }
  const { updateTaskProgress, getProgressView } = require('../Shared/progressModel.ts')
  const { isSupportedMediaPath, probeMediaFile, matchesMediaFormat } = require('../Back-End/electron/services/mediaService.ts')

  const { AUDIO_FORMATS } = require('../Shared/types.ts')
  const { DirectEngine } = require('../Back-End/electron/engines/DirectEngine.ts')
  const { DownloadManager } = require('../Back-End/electron/downloadManager.ts')
  const { YoutubeEngine } = require('../Back-End/electron/engines/YoutubeEngine.ts')
  const { throttledSendUpdate, computeSpeed } = require('../Back-End/electron/utils.ts')

  const { parseStateTransition, parseDownloadProgress } = require('../Back-End/electron/progressParser.ts')
  const { FfmpegEngine } = require('../Back-End/electron/engines/FfmpegEngine.ts')

  function task(overrides = {}) {
    return { id: '11111111-1111-4111-8111-111111111111', url: 'https://example.com/file', directory: '', filename: 'file.mp4', filePath: '', engine: 'direct', targetFormat: 'mp4', status: 'downloading', totalBytes: 100, downloadedBytes: 0, speedBytesPerSec: null, errorMessage: null, createdAtMs: 1, updatedAtMs: 1, ...overrides }
  }
  function runtime() { return { abortController: null, child: null, lastSpeedSampleAtMs: null, lastSpeedSampleBytes: null, lastIpcAtMs: 0, retries: 0 } }
  function context(rt) { return { runtime: rt, sendUpdate: t => updateTaskProgress(t), saveState: () => {}, flushSave: () => {}, scheduleRetry: () => {}, sendStats: () => {}, sendYouTubeOAuthCode: () => {} } }

  function server(body, ignoreRange = false, slow = false) {
    let rangeRequests = 0
    const instance = http.createServer((req, res) => {
      if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': body.length, 'accept-ranges': 'bytes', etag: '"fixture-v1"' }); res.end(); return }
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
      if (match) rangeRequests++
      const start = match && !ignoreRange ? Number(match[1]) : 0
      const end = match && match[2] && !ignoreRange ? Number(match[2]) : body.length - 1
      const part = body.subarray(start, end + 1)
      res.writeHead(match && !ignoreRange ? 206 : 200, {
        'content-length': part.length,
        ...(match && !ignoreRange ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}),
      })
      if (!slow) { res.end(part); return }
      let offset = 0
      const timer = setInterval(() => {
        if (res.destroyed) { clearInterval(timer); return }
        const next = part.subarray(offset, offset + 32768)
        offset += next.length
        res.write(next)
        if (offset >= part.length) { clearInterval(timer); res.end() }
      }, 3)
    })
    return { instance, get rangeRequests() { return rangeRequests } }
  }
  async function withServer(body, ignoreRange, slow, fn) {
    const s = server(body, ignoreRange, slow)
    await new Promise(resolve => s.instance.listen(0, '127.0.0.1', resolve))
    try { await fn(`http://127.0.0.1:${s.instance.address().port}/file`, s) }
    finally { s.instance.closeAllConnections(); await new Promise(resolve => s.instance.close(resolve)) }
  }

  test('Direct backend progress reserves 100 for validated completion in the shared view', () => {
    const t = task({ downloadedBytes: 100 })
    updateTaskProgress(t)
    assert.equal(t.overallProgress, 99)
    assert.deepEqual(getProgressView(t), getProgressView({ ...t }))
    assert.equal(getProgressView(t).percentLabel, '99%')
    t.status = 'error'
    updateTaskProgress(t)
    assert.equal(t.overallProgress, 99)
  })
  test('unknown-length progress is indeterminate and Direct speed uses byte delta', () => {
    const t = task({ totalBytes: null, downloadedBytes: 1024 })
    updateTaskProgress(t)
    assert.equal(getProgressView(t).isIndeterminate, true)
    const rt = runtime()
    rt.lastSpeedSampleAtMs = Date.now() - 1000
    rt.lastSpeedSampleBytes = 0
    computeSpeed(t, rt)
    assert.ok(t.speedBytesPerSec > 0)
  })
  test('YouTube video/audio progress stays monotonic and post-processing is truthful', () => {
    const t = task({ engine: 'ytdlp', ytdlpExpectedBytes: 200 })
    parseDownloadProgress('CORTEX_DL|video|video.part|100|100|10', t)
    updateTaskProgress(t)
    const first = t.overallProgress
    parseDownloadProgress('CORTEX_DL|audio|audio.part|1|100|10', t)
    updateTaskProgress(t)
    assert.ok(t.overallProgress >= first)
    assert.equal(t.downloadedBytes, 101)
    parseDownloadProgress('CORTEX_DL|audio|audio.part|0|100|10', t)
    assert.equal(t.downloadedBytes, 101, 'same-stream retry must not add bytes')
    parseDownloadProgress('CORTEX_DL|audio|audio.part|50|100|10', t)
    assert.equal(t.downloadedBytes, 150)
    const resumed = task({ engine: 'ytdlp', ytdlpExpectedBytes: 200, ytdlpStreams: structuredClone(t.ytdlpStreams) })
    parseDownloadProgress('CORTEX_DL|audio|audio.part|50|100|10', resumed)
    assert.equal(resumed.downloadedBytes, 150, 'resumed stream must not double-count')
    parseStateTransition('[Merger] Merging formats into "x.mp4"', t, { totalDuration: null, stderr: '' }, { sendUpdate: updateTaskProgress, saveState: () => {} })
    assert.equal(t.phase, 'merging')
    assert.equal(t.phaseProgress, null)
    assert.equal(t.overallProgress, null)
    t.status = 'converting'; updateTaskProgress(t)
    assert.equal(t.phase, 'converting')
    assert.equal(t.overallProgress, null)
    t.status = 'completed'; updateTaskProgress(t)
    assert.equal(t.overallProgress, 100)
  })
  test('all shared media formats, including uncommon ones, validate', () => {
    for (const ext of ['flac', 'aac', 'opus', 'wma', 'ogv', 'm4v', 'gif']) assert.equal(isSupportedMediaPath(`file.${ext}`), true)
    assert.equal(isSupportedMediaPath('file.part'), false)
  })
  test('yt-dlp continuation flags preserve partial files', () => {
    const yt = new YoutubeEngine()
    const args = yt.buildYtdlpArgs(task({ engine: 'ytdlp' }), 'bestVideo', { ffmpegDir: '.' }, runtime())
    assert.ok(args.includes('--continue'))
    assert.ok(!args.includes('--force-overwrites'))
    assert.ok(!args.includes('--no-check-certificate'))
    assert.ok(args.some(arg => arg.includes('%(info.format_id)s') && arg.includes('%(progress.filename)s')))
  })

  test('yt-dlp continuation quality selects 4K over lower AVC and respects resolution caps', async t => {
    const binary = path.join(process.cwd(), 'engine-baseline', 'yt-dlp.exe')
    if (!existsSync(binary)) return t.skip('Bundled yt-dlp is unavailable')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-quality-'))
    try {
      const infoPath = path.join(dir, 'info.json')
      const video = (id, height, vcodec, ext) => ({ format_id: id, height, width: height * 16 / 9, fps: 30, vcodec, acodec: 'none', ext, url: `https://fixture.invalid/${id}` })
      const formats = [video('avc-1080', 1080, 'avc1.640028', 'mp4'), video('vp9-2160', 2160, 'vp9', 'webm'),
        { format_id: 'audio', vcodec: 'none', acodec: 'mp4a.40.2', ext: 'm4a', abr: 128, url: 'https://fixture.invalid/audio' }]
      const select = async (profile, quality, available) => {
        await fs.writeFile(infoPath, JSON.stringify({ id: 'fixture', title: 'Quality fixture', extractor: 'generic', webpage_url: 'https://fixture.invalid/video', formats: available }))
        const args = new YoutubeEngine().buildYtdlpArgs(task({ targetFormat: profile === 'bestVideo' ? 'mp4' : 'mkv', ytdlpFormatId: quality }), profile, { ffmpegDir: '.' }, runtime())
        assert.equal(args.includes('--cookies'), false)
        const result = spawnSync(binary, ['--ignore-config', '--simulate', '--no-check-formats', '--load-info-json', infoPath, '--dump-single-json', '-f', args[args.indexOf('-f') + 1], '-S', args[args.indexOf('-S') + 1]], { encoding: 'utf8', timeout: 15000 })
        assert.equal(result.status, 0, result.stderr)
        return JSON.parse(result.stdout).format_id
      }
      for (const profile of ['bestVideo', 'default']) {
        assert.equal(await select(profile, undefined, formats), 'vp9-2160+audio')
        assert.equal(await select(profile, '1080p', formats), 'avc-1080+audio')
        const progressive = [720, 2160].map(height => ({ ...video(`combined-${height}`, height, 'avc1', 'mp4'), acodec: 'mp4a.40.2' }))
        assert.equal(await select(profile, '1080p', progressive), 'combined-720')
      }

      const tiedFormats = [...formats, video('vp9-1080', 1080, 'vp9', 'webm')]
      assert.equal(await select('bestVideo', '1080p', tiedFormats), 'avc-1080+audio')
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('Pause All pauses queued and active phases; retry timers cannot resurrect canceled/deleted tasks', async () => {
    const manager = new DownloadManager()
    manager.schedule = () => {}
    const queued = task({ id: 'queued', status: 'queued' })
    const active = ['downloading', 'merging', 'converting'].map((status, i) => task({ id: `active-${i}`, status }))
    for (const t of [queued, ...active]) {
      manager.tasks.set(t.id, t); manager.runtime.set(t.id, runtime())
      if (t !== queued) { manager.active.add(t.id); manager.engines.set(t.id, { pause: () => {}, stop: () => {} }) }
    }
    await manager.pauseAll()
    assert.equal(queued.status, 'paused')
    for (const t of active) assert.equal(t.status, 'paused')
    await manager.resumeAll()
    assert.equal(queued.status, 'queued')
    manager.scheduleRetry('queued', 10000)
    await manager.cancel('queued')
    assert.equal(manager.retryTimers.has('queued'), false)
    const other = task({ id: 'delete', status: 'queued' })
    manager.tasks.set(other.id, other); manager.runtime.set(other.id, runtime())
    manager.scheduleRetry(other.id, 10000)
    await manager.delete(other.id, false)
    assert.equal(manager.retryTimers.has(other.id), false)
    assert.equal(manager.tasks.has(other.id), false)
  })
  test('delete without file removal preserves output', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-delete-'))
    const filePath = path.join(directory, 'kept.mp4')
    await fs.writeFile(filePath, 'keep')
    try {
      const manager = new DownloadManager()
      manager.schedule = () => {}
      const t = task({ id: 'keep', directory, filePath, status: 'completed' })
      manager.tasks.set(t.id, t); manager.runtime.set(t.id, runtime())
      await manager.delete(t.id, false)
      assert.equal(await fs.readFile(filePath, 'utf8'), 'keep')
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
  test('SQLite progress uses backend overall progress', () => {
    const manager = new DownloadManager()
    const item = task({ engine: 'ytdlp', status: 'merging', downloadedBytes: 100, totalBytes: 100 })
    manager.upsertTaskToDb(item)
    assert.equal(dbMock.lastRow.progress, item.overallProgress)
    assert.equal(dbMock.lastRow.progress, null)
    assert.equal(JSON.parse(dbMock.lastRow.full_payload).overallProgress, null)
    manager.upsertTaskToDb(task({ totalBytes: null, downloadedBytes: 10 }))
    assert.equal(dbMock.lastRow.progress, null)
  })
  test('resume broadcasts a consistent downloading phase', async () => {
    const manager = new DownloadManager()
    manager.schedule = () => {}
    const item = task({ id: 'resume-phase', engine: 'missing-engine', status: 'queued', phase: 'paused' })
    manager.tasks.set(item.id, item); manager.runtime.set(item.id, runtime())
    const updates = []
    manager.attachWindow({ isDestroyed: () => false, webContents: { send: (_channel, data) => updates.push({ ...data }) } })
    await manager.executeEngine(item.id)
    assert.equal(updates[0].status, 'downloading')
    assert.notEqual(updates[0].phase, 'paused')
  })
  test('terminal IPC state bypasses throttle and cancels stale trailing update', () => {
    const sent = []
    const win = { isDestroyed: () => false, webContents: { send: (_channel, value) => sent.push({ ...value }) } }
    const rt = runtime()
    const t = task()
    throttledSendUpdate(win, t, rt)
    t.downloadedBytes = 20; throttledSendUpdate(win, t, rt)
    t.status = 'paused'; throttledSendUpdate(win, t, rt)
    assert.equal(sent.at(-1).status, 'paused')
    assert.equal(sent.length, 2)
  })
  test('IPC phase changes remain visible within one throttle window and retire stale progress', async () => {
    const manager = new DownloadManager()
    const item = task({ id: 'fast-phase', attemptId: 'attempt', phase: 'downloading' })
    const attempt = { ...runtime(), attemptId: 'attempt', abortController: new AbortController() }
    manager.tasks.set(item.id, item)
    manager.runtime.set(item.id, attempt)
    manager.attempts.set(item.id, attempt)
    const sent = []
    manager.attachWindow({ isDestroyed: () => false, webContents: { send: (_channel, value) => sent.push({ ...value }) } })
    const draft = { ...item }
    const ctx = manager.createContext(item.id, attempt, draft)
    const clock = Date.now
    const now = clock()
    attempt.lastIpcAtMs = now
    Date.now = () => now
    try {
      ctx.sendUpdate(draft)
      draft.status = 'converting'; draft.phase = 'trimming'; ctx.sendUpdate(draft)
      draft.convertingPercent = 20; ctx.sendUpdate(draft)
      draft.phase = 'validating'; ctx.sendUpdate(draft)
      draft.phase = 'finalizing'; ctx.sendUpdate(draft)
      assert.deepEqual(sent.map(value => value.phase), ['trimming', 'validating', 'finalizing'])
      Date.now = clock
      await new Promise(resolve => setTimeout(resolve, 140))
      assert.equal(sent.length, 3, 'queued progress must not overwrite a newer phase')
      attempt.stopReason = 'canceled'
      draft.phase = 'trimming'; ctx.sendUpdate(draft)
      assert.equal(sent.length, 3, 'stopped attempts must remain ignored')
    } finally { Date.now = clock; manager.flushPendingSave() }
  })
  const ffmpegBinary = path.join(process.cwd(), 'engine-baseline', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const ffprobeBinary = path.join(process.cwd(), 'engine-baseline', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  const ytdlpBinary = path.join(process.cwd(), 'engine-baseline', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  function makeAudioFixture(input, output, args) {
    const result = spawnSync(ffmpegBinary, ['-y', '-hide_banner', '-loglevel', 'error', ...args, output], { timeout: 30000 })
    assert.equal(result.status, 0, result.stderr?.toString())
  }

  test('bundled yt-dlp emits stream identity in the progress template', async t => {
    if (!existsSync(ffmpegBinary) || !existsSync(ytdlpBinary)) return t.skip('bundled media tools unavailable')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-ytdlp-template-'))
    const source = path.join(directory, 'clip.m4a')
    makeAudioFixture(null, source, ['-f', 'lavfi', '-i', 'sine=duration=0.25', '-c:a', 'aac', '-f', 'ipod'])
    const body = await fs.readFile(source)
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': body.length })
      res.end(body)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const template = 'download:CORTEX_DL|%(info.format_id)s|%(progress.filename)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s'
      const child = require('node:child_process').spawn(ytdlpBinary, [
        '--ignore-config', '--no-playlist', '--no-mtime', '--newline', '--progress',
        '--progress-template', template, '-o', path.join(directory, 'download.%(ext)s'),
        `http://127.0.0.1:${server.address().port}/clip.m4a`,
      ], { windowsHide: true })
      let output = ''
      child.stdout.on('data', data => { output += data.toString() })
      child.stderr.on('data', data => { output += data.toString() })
      const code = await new Promise(resolve => { child.on('close', resolve); child.on('error', () => resolve(1)) })
      assert.equal(code, 0, output)
      const item = task({ engine: 'ytdlp' })
      assert.equal(parseDownloadProgress(output, item), true, output)
      assert.ok(Object.keys(item.ytdlpStreams).some(key => key.includes('download.m4a')))
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('FFmpeg engine creates real codec/container output for every audio format', async t => {
    if (!existsSync(ffmpegBinary) || !existsSync(ffprobeBinary)) return t.skip('bundled FFmpeg tools unavailable')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-audio-engine-'))
    try {
      const source = path.join(directory, 'source.wav')
      makeAudioFixture(null, source, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25', '-c:a', 'pcm_s16le'])
      for (const format of AUDIO_FORMATS) {
        const output = path.join(directory, `engine.${format}`)
        const rt = runtime()
        const item = task({ engine: 'ffmpeg', targetFormat: format, url: source, filePath: output, directory })
        const result = await new FfmpegEngine().download(item, context(rt))
        assert.equal(result.kind, 'success', format)
        assert.equal(item.status, 'downloading', 'only manager can complete')
        assert.ok(matchesMediaFormat(format, await probeMediaFile(item.filePath)), format)
      }
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  test('DirectEngine range chunks and advertised-Range fallback produce exact output', async () => {
    const body = Buffer.alloc(5 * 1024 * 1024 + 4096, 73)
    for (const ignore of [false, true]) {
      await withServer(body, ignore, false, async (url, s) => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-test-'))
        try {
          const t = task({ url, directory, filePath: path.join(directory, 'file.mp4'), totalBytes: null })
          await new DirectEngine().download(t, context(runtime()))
          assert.deepEqual(await fs.readFile(t.filePath), body)
          assert.equal(t.overallProgress, 99)
          assert.ok(s.rangeRequests > 0)
          if (ignore) assert.equal(t.supportsRanges, undefined)
        } finally { await fs.rm(directory, { recursive: true, force: true }) }
      })
    }
  })
  test('DirectEngine pause and resume keeps chunk state', async () => {
    const body = Buffer.alloc(5 * 1024 * 1024 + 4096, 42)
    await withServer(body, false, true, async url => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-resume-'))
      try {
        const t = task({ url, directory, filePath: path.join(directory, 'file.mp4'), totalBytes: null })
        const engine = new DirectEngine()
        const first = engine.download(t, context(runtime()))
        await new Promise(resolve => setTimeout(resolve, 30))
        engine.pause()
        assert.equal((await first).kind, 'paused')
        assert.ok(t.resumeChunks?.length)
        await new DirectEngine().download(t, context(runtime()))
        assert.deepEqual(await fs.readFile(t.filePath), body)
      } finally { await fs.rm(directory, { recursive: true, force: true }) }
    })
  })
  test('Direct Range fallback stays single-stream after pause and resume', async () => {
    const body = Buffer.alloc(5 * 1024 * 1024 + 4096, 55)
    await withServer(body, true, true, async (url, s) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-fallback-resume-'))
      try {
        const item = task({ url, directory, filePath: path.join(directory, 'file.mp4'), totalBytes: null })
        const engine = new DirectEngine()
        const first = engine.download(item, context(runtime()))
        const deadline = Date.now() + 5000
        while (!(item.supportsRanges === false && item.downloadedBytes > 32768) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        assert.equal(item.supportsRanges, false)
        assert.ok(item.downloadedBytes > 32768)
        engine.pause()
        assert.equal((await first).kind, 'paused')
        const beforeResume = s.rangeRequests
        await new DirectEngine().download(item, context(runtime()))
        assert.ok(s.rangeRequests - beforeResume <= 1, 'resume may probe once, but must not restart chunk mode')
        assert.deepEqual(await fs.readFile(item.filePath), body)
      } finally { await fs.rm(directory, { recursive: true, force: true }) }
    })
  })

  test('progress preserves validating/finalizing phases after a compatible yt-dlp merge', () => {
    for(const phase of ['validating','finalizing']) {
      const t=task({status:'merging',phase,engine:'ytdlp',downloadPercent:100,downloadedBytes:100,totalBytes:100})
      updateTaskProgress(t)
      assert.equal(t.phase,phase)
      assert.equal(t.phaseProgress,null)
      assert.equal(t.overallProgress,null)
      assert.equal(getProgressView(t).isIndeterminate,true)
    }
  })

  test('progress shows measured validation progress without completing early', () => {
    const t=task({status:'merging',phase:'validating',convertingPercent:42,downloadPercent:100})
    updateTaskProgress(t)
    assert.equal(t.phaseProgress,42)
    assert.equal(getProgressView(t).isIndeterminate,false)
    t.convertingPercent=100;updateTaskProgress(t)
    assert.equal(t.overallProgress,99)
    assert.notEqual(t.status,'completed')
    t.phase='finalizing';updateTaskProgress(t)
    assert.equal(t.phaseProgress,null)
  })

  test('progress replaces an approximate metadata total once every selected stream is observed', () => {
    const t=task({engine:'ytdlp',ytdlpExpectedBytes:400,ytdlpExpectedStreamCount:2})
    parseDownloadProgress('CORTEX_DL|video|v.part|50|100|10',t)
    assert.equal(t.totalBytes,400)
    parseDownloadProgress('CORTEX_DL|audio|a.part|25|100|10',t)
    assert.equal(t.totalBytes,200)
    assert.equal(t.downloadedBytes,75)
    assert.equal(t.downloadPercent,38)
  })
})

suite('YouTube access', test => {
  const assert = require('node:assert/strict')
  const Module = require('node:module')
  const os = require('node:os')
  const originalLoad = Module._load
  const calls = []
  let fixtureWarnings = ''
  let extract = async () => info(1080)
  function info(height) {
    return JSON.stringify({ title: 'Fixture', formats: [{ format_id: String(height), height, vcodec: 'avc1', acodec: 'none' }],
      automatic_captions: { ar: [{ name: 'Arabic' }] } })
  }
  Module._load = function(request, parent, ...rest) {
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
    if (request === 'electron-log') return { info(){}, warn(){}, error(){} }
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() } }
    if (request === './paths' || request === '../paths') return { getBinaryPath: () => process.execPath, getBinDirectory: () => os.tmpdir() }
    if (request.endsWith('/analysisService')) return { ...originalLoad.call(this, request, parent, ...rest), extractAnalysis: async (_binary, args, signal, _bytes, _timeout, diagnostics) => {
      signal.throwIfAborted(); calls.push(args); const output = await extract(args); diagnostics?.(fixtureWarnings); return output
    } }
    if (request.endsWith('/thumbnailService')) return { PREVIEW_FORMAT: 'best', TRIM_PREVIEW_FORMAT: 'bestvideo+bestaudio',
      extractPreview: async (_binary, args) => { calls.push(args); return extract(args) },
      extractPreviewStreams: async (_binary, args) => { calls.push(args); return extract(args) } }
    if (request.endsWith('/mediaService') && parent.filename.endsWith('YoutubeEngine.ts')) return { ...originalLoad.call(this, request, parent, ...rest),
      findTaskMediaFile: async () => 'fixture.mp4',
    }
    return originalLoad.call(this, request, parent, ...rest)
  }
  const { youtubeErrorCode, isYouTubeAuthRequiredError, isYouTubeUrl } = require('../Shared/youtubeErrors.ts')
  const { analyzeWithYtdlp, assertAnalysisAllowed, getDirectStreamUrl, getTrimPreviewStreams } = require('../Back-End/electron/engines/ytdlpService.ts')
  const { YoutubeEngine } = require('../Back-End/electron/engines/YoutubeEngine.ts')
  const { normalizeIpcError, youtubeErrorMessage } = require('../Front-End/src/lib/downloadHelpers.ts')
  const { translations } = require('../Front-End/src/translations.ts')

  test('YouTube 429 is never reported as authentication, including generic login advice', () => {
    const subtitle = "ERROR: HTTP Error 429: Too Many Requests. Sign in to confirm you are not a bot"
    for (const error of [subtitle, new Error(subtitle), { stderr: subtitle }, new Error('Failed', { cause: new Error(subtitle) })]) {
      assert.equal(youtubeErrorCode(error), 'YOUTUBE_RATE_LIMITED')
      assert.equal(isYouTubeAuthRequiredError(error), false)
    }
    assert.equal(youtubeErrorCode('HTTP Error 429. Use --cookies-from-browser or --cookies'), 'YOUTUBE_RATE_LIMITED')
    assert.equal(youtubeErrorCode('Sign in to confirm you are not a bot'), 'YOUTUBE_BOT_VERIFICATION')
    assert.equal(youtubeErrorCode('HTTP Error 403: Forbidden'), null)
  })

  test('YouTube public policy validates exact hostnames', () => {
   assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=abcdefghijk'),true);
   assert.equal(isYouTubeUrl('https://youtube.com.evil.invalid/watch?v=abcdefghijk'),false);
   assert.equal(isYouTubeUrl('https://example.invalid/?url=youtube.com'),false);
  })

  test('YouTube analysis preserves 1080p when configured cookies would expose only 360p', async () => {
    calls.length = 0
    extract = async args => info(args.includes('--cookies') ? 360 : 1080)
    const result = await analyzeWithYtdlp('https://youtu.be/publicfix01')
    assert.equal(result.formats[0].height, 1080)
    assert.equal(Object.hasOwn(result, 'subtitles'), false)
    assert.equal(Object.hasOwn(result, 'captionDiscovery'), false)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].includes('--cookies'), false)
  })

  test('YouTube first analysis initializes Deno and retains warnings with no client overrides', async () => {
    calls.length = 0
    extract = async () => info(1440)
    const result = await analyzeWithYtdlp('https://youtu.be/runtimefix1')
    assert.equal(result.formats[0].height, 1440)
    assert.equal(calls[0].includes('--js-runtimes'), true)
    assert.equal(calls[0].includes('--no-warnings'), false)
    assert.equal(calls[0].includes('--ignore-config'), true)
    assert.equal(calls[0].includes('--extractor-args'), false)
  })

  test('YouTube classifier requires actual PO token diagnostics and never treats generic cookie advice as authentication', () => {
    for (const [message, code] of [
      ['ERROR: Failed to resolve host; use --cookies-from-browser or --cookies', 'YOUTUBE_NETWORK_ERROR'],
      ['WARNING: GVS PO Token not provided; formats require a PO Token', 'YOUTUBE_PO_TOKEN_REQUIRED'],
      ['WARNING: formats have been skipped as they are missing a url', 'YOUTUBE_FORMATS_RESTRICTED'],
      ['HTTP Error 403', null], ['Use --cookies-from-browser or --cookies', null],
    ]) assert.equal(youtubeErrorCode(message), code)
  })

  test('YouTube analysis reports private content without retrying an account',async()=>{
   calls.length=0;extract=async()=>{throw new Error('Sign in to confirm your age')};
   await assert.rejects(analyzeWithYtdlp('https://youtu.be/privatefix1'),/YOUTUBE_AUTH_REQUIRED/);
   assert.equal(calls.length,1);assert.ok(!calls[0].includes('--cookies'));
  })

  test('YouTube analysis 429 makes one request and does not switch to cookies', async () => {
    calls.length = 0
    extract = async () => { throw new Error('HTTP Error 429: Too Many Requests; use --cookies-from-browser or --cookies') }
    await assert.rejects(analyzeWithYtdlp('https://youtu.be/limitedfix1'), /YOUTUBE_RATE_LIMITED/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].includes('--cookies'), false)
  })

  test('YouTube previews propagate sign-in without account retries',async()=>{
   for(const preview of [getDirectStreamUrl,getTrimPreviewStreams]){
   calls.length=0;extract=async()=> 'https://fixture.invalid/video';await preview('https://youtu.be/previewfix1');assert.equal(calls.length,1);
   calls.length=0;extract=async()=>{throw new Error('LOGIN_REQUIRED')};await assert.rejects(preview('https://youtu.be/previewfix1'),/YOUTUBE_AUTH_REQUIRED/);assert.equal(calls.length,1);}
  })

  test('YouTube public analysis honors pre-canceled requests',async()=>{
   calls.length=0;const controller=new AbortController();controller.abort();await assert.rejects(analyzeWithYtdlp('https://youtu.be/cancelfix01',controller.signal),/abort/i);assert.equal(calls.length,0);
  })

  function task() {
    return { id: 'fixture', url: 'https://youtu.be/abcdefghijk', directory: os.tmpdir(), filename: 'fixture.mp4',
      filePath: 'fixture.mp4', title: 'Fixture', thumbnail: 'https://fixture.invalid/thumb', targetFormat: 'mp4',
      status: 'downloading', ytdlpFormatId: '1080p' }
  }
  function context() { return { runtime: { abortController: null, child: null, retries: 0 }, sendUpdate(){}, saveState(){} } }

  test('YouTube download keeps selected quality without sending cookies on public success', async () => {
    const engine = new YoutubeEngine(), seen = []
    engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
      seen.push(args); return { exitCode: 0, detectedFinalPath: 'fixture.mp4', stderr: '' }
    }
    assert.equal((await engine.download(task(), context())).kind, 'success')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].includes('--cookies'), false)
    assert.match(seen[0][seen[0].indexOf('-f') + 1], /height<=1080/)
  })

  test('YouTube public media omits generic provider credentials while other providers retain explicit login', () => {
    const engine = new YoutubeEngine(), login = { ...task(), username: 'fixture-user', password: 'fixture-password' }
    const publicArgs = engine.buildYtdlpArgs(login, 'bestVideo', { ffmpegDir: os.tmpdir() }, context().runtime)
    assert.equal(publicArgs.includes('--username'), false)
    assert.equal(publicArgs.includes('--password'), false)
    const providerArgs = engine.buildYtdlpArgs({ ...login, url: 'https://vimeo.com/123' }, 'bestVideo', { ffmpegDir: os.tmpdir() }, context().runtime)
    assert.equal(providerArgs.includes('--username'), true)
    assert.equal(providerArgs.includes('--password'), true)
    assert.equal(providerArgs.includes('--cookies'), false)
  })

  test('YouTube download fails once for authentication and request throttling', async () => {
    for (const failure of ['LOGIN_REQUIRED', 'HTTP Error 429: Too Many Requests']) {
      const engine = new YoutubeEngine(), seen = []
      engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
        seen.push(args); return { exitCode: 1, detectedFinalPath: null, stderr: failure }
      }
      const result = await engine.download(task(), context())
      assert.deepEqual(result, { kind: 'fatal-error', message: failure === 'LOGIN_REQUIRED' ? 'YOUTUBE_AUTH_REQUIRED' : 'YOUTUBE_RATE_LIMITED' })
      assert.equal(seen.length, 1)
      assert.equal(seen[0].includes('--cookies'), false)
    }
  })

  test('Arabic and English errors distinguish bot verification, request throttling and viewing permission', () => {
    for (const messages of Object.values(translations)) {
      for (const [code, message] of [['YOUTUBE_AUTH_REQUIRED', messages.youtube_auth_required],
        ['YOUTUBE_RATE_LIMITED', messages.youtube_rate_limited],
        ['YOUTUBE_BOT_VERIFICATION', messages.youtube_bot_verification]]) {
        assert.equal(youtubeErrorMessage(code, messages), message)
        assert.equal(normalizeIpcError(new Error(`Error invoking remote method 'analyze': Error: ${code}`), 'fallback', messages), message)
      }
      assert.equal(normalizeIpcError('HTTP Error 429: Too Many Requests', 'fallback', messages), messages.youtube_rate_limited)
      assert.equal(normalizeIpcError('', 'fallback', messages), 'fallback')
    }
  })

  test('YouTube bot verification is reported separately, without caption advice or repeated analysis requests', async () => {
    calls.length = 0
    extract = async () => { throw new Error("Sign in to confirm you're not a bot. Use --cookies") }
    const url = 'https://youtu.be/botfixture1'
    await assert.rejects(analyzeWithYtdlp(url), /YOUTUBE_BOT_VERIFICATION/)
    await assert.rejects(analyzeWithYtdlp('https://www.youtube.com/watch?v=botfixture1&si=shared&t=10'), /YOUTUBE_BOT_VERIFICATION/)
    assert.throws(() => assertAnalysisAllowed('https://www.youtube.com/shorts/botfixture1'), /YOUTUBE_BOT_VERIFICATION/)
    await assert.rejects(analyzeWithYtdlp(url), /YOUTUBE_BOT_VERIFICATION/)
    assert.equal(calls.length, 1)
    for (const messages of Object.values(translations)) {
      assert.equal(normalizeIpcError(new Error('YOUTUBE_BOT_VERIFICATION'), 'fallback', messages), messages.youtube_bot_verification)
      assert.equal(normalizeIpcError('DOWNLOAD_RETRY_REQUIRED', 'fallback', messages), messages.download_retry_required)
      assert.doesNotMatch(messages.youtube_bot_verification, /Subtitles|ترجمات|ترجمة|cookies/i)
    }
  })

  test('YouTube video engine ignores obsolete subtitle selections even when passed by legacy callers', async () => {
    const engine = new YoutubeEngine(), seen = []
    engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
      seen.push(args); return { exitCode: 0, detectedFinalPath: 'fixture.mp4', stderr: '' }
    }
    assert.deepEqual(await engine.download({ ...task(), subtitleLanguage: 'ar', subtitleIsAutomatic: true }, context()), { kind: 'success', candidate: 'fixture.mp4' })
    assert.equal(seen.length, 1)
    for (const flag of ['--write-auto-subs', '--write-subs', '--sub-langs', '--embed-subs', '--cookies']) assert.equal(seen[0].includes(flag), false)
  })

  test('YouTube media 403 tries public HLS once with the same quality', async () => {
    const engine = new YoutubeEngine(), seen = []
    engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
      seen.push(args)
      return seen.length === 1 ? { exitCode: 1, detectedFinalPath: null, stderr: 'unable to download video data: HTTP Error 403: Forbidden' }
        : { exitCode: 0, detectedFinalPath: 'fixture.mp4', stderr: '' }
    }
    assert.equal((await engine.download(task(), context())).kind, 'success')
    assert.equal(seen.length, 2)
    const selector = seen[1][seen[1].indexOf('-f') + 1]
    assert.equal(selector, 'bestvideo[protocol^=m3u8][height<=1080]+bestaudio[protocol^=m3u8]/best[protocol^=m3u8][height<=1080]')
    assert.equal(seen[1].includes('--cookies'), false)
  })

  test('YouTube HLS fallback is bounded and honors cancellation', async () => {
    for (const mode of ['media', 'cancel']) {
      const engine = new YoutubeEngine(), seen = [], ctx = context()
      engine.runYtdlpAttempt = async (_task, _context, runtime, args) => {
        seen.push(args)
        if (mode === 'cancel') runtime.abortController.abort()
        return { exitCode: 1, detectedFinalPath: null, stderr: 'unable to download video data: HTTP Error 403: Forbidden' }
      }
      if (mode === 'cancel') await assert.rejects(engine.download(task(), ctx), /abort/i)
      else assert.equal((await engine.download(task(), ctx)).kind, 'fatal-error')
      assert.equal(seen.length, mode === 'media' ? 2 : 1)
    }
  })
})

suite('Analysis errors', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
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
})
