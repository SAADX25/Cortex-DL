/* Isolated real-Electron benchmark. Never opens or changes the user's catalog/media.
   Run: node scripts/media-library-benchmark.cjs [output.json] [--baseline=ref]
   The picker uses a timed fixture; human interaction is deliberately excluded. */
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const cp = require('node:child_process'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const audited = ['Back-End/electron/mediaLibrary.ts', 'Back-End/electron/ipc/mediaLibraryIpc.ts', 'Back-End/electron/libraryThumbnails.ts', 'Back-End/electron/audioArtwork.ts', 'Front-End/src/components/MediaLibrary.tsx', 'Front-End/src/components/LibraryThumbnail.tsx', 'Front-End/src/stores/useMediaLibraryStore.ts']
const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length) || process.env.CORTEX_LIBRARY_BENCH_REF
const source = file => cp.execFileSync('git', ['show', baseline + ':app/' + file], { cwd: root, encoding: 'utf8', windowsHide: true })
const now = () => performance.timeOrigin + performance.now()
async function launcher() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-import-benchmark-'))
  try {
    const ffmpeg = path.join(root, 'engine-baseline/ffmpeg.exe')
    const media = (args, name) => { const file = path.join(directory, name); cp.execFileSync(ffmpeg, ['-y', '-v', 'error', ...args, file], { windowsHide: true, timeout: 15000 }); return file }
    const cover = media(['-f', 'lavfi', '-i', 'color=c=blue:size=128x128', '-frames:v', '1'], 'art.jpg')
    const audio = media(['-f', 'lavfi', '-i', 'sine=duration=0.5', '-i', cover, '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'copy', '-disposition:v', 'attached_pic'], 'covered.mp3')
    const video = media(['-f', 'lavfi', '-i', 'testsrc2=size=128x72:duration=1.5', '-c:v', 'libx264', '-preset', 'ultrafast'], 'video.mp4')
    const plain = media(['-f', 'lavfi', '-i', 'sine=duration=0.5'], 'plain.wav')
    const samples = [audio, video, plain], files = []
    for (let i = 0; i < 1200; i++) {
      const source = samples[i % 3], target = path.join(directory, 'media-' + i + path.extname(source))
      await fs.copyFile(source, target); files.push(target)
    }
    await fs.writeFile(path.join(directory, 'files.json'), JSON.stringify(files))
    await require('esbuild').build({ entryPoints: [path.join(root, 'tests/fixtures/mediaLibraryBenchmark.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' }, plugins: baseline ? [{ name: 'audit-baseline', setup(build) {
      build.onLoad({ filter: /\.[jt]sx?$/ }, args => {
        const relative = path.relative(root, args.path).replaceAll('\\', '/')
        if (audited.includes(relative)) return { contents: source(relative), loader: relative.endsWith('tsx') ? 'tsx' : 'ts' }
      })
    } }] : [] })
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    const env = { ...process.env, CORTEX_LIBRARY_BENCH_DIR: directory, CORTEX_LIBRARY_BENCH_REF: baseline || '' }; delete env.ELECTRON_RUN_AS_NODE
    await new Promise((resolve, reject) => {
      const child = cp.spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
      const timer = setTimeout(() => { child.kill(); reject(Error('Benchmark timeout\n' + output)) }, 120000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(output)) })
    })
    const result = await fs.readFile(path.join(directory, 'result.json'), 'utf8')
    const output = process.argv.slice(2).find(arg => !arg.startsWith('--'))
    if (output) {
      const file = path.resolve(output); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, result)
    }
    console.log(result)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}
async function electronBenchmark() {
  const { app, BrowserWindow, ipcMain } = require('electron'), Module = require('node:module')
  const directory = process.env.CORTEX_LIBRARY_BENCH_DIR
  app.disableHardwareAcceleration(); app.setPath('userData', path.join(directory, 'profile'))
  require(path.join(root, 'tests/register-ts.cjs'))
  if (baseline) {
    const ts = require('typescript'), original = require.extensions['.ts']
    require.extensions['.ts'] = (module, file) => {
      const relative = path.relative(root, file).replaceAll('\\', '/')
      if (!audited.includes(relative)) return original(module, file)
      module._compile(ts.transpileModule(source(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
    }
  }
  let stats, phase = 'idle', selected = [], pickerMs = 0
  const fresh = () => ({ fs: {}, processes: { ffprobe: 0, ffmpeg: 0, peak: 0 }, inspectMs: 0, inspectPeak: 0, validationWallMs: 0, saveMs: 0, stringifyMs: 0, probes: [], thumbnails: [], handlers: [] })
  stats = fresh()
  let children = 0, inspections = 0
  for (const name of ['stat', 'lstat', 'access', 'readFile', 'mkdir', 'open', 'writeFile', 'rename', 'unlink', 'readdir']) {
    const original = fs[name]
    fs[name] = async (...args) => {
      const target = stats, label = phase + ':' + name, start = now()
      target.fs[label] ??= { count: 0, totalMs: 0 }; target.fs[label].count++
      try {
        const result = await original(...args)
        if (name === 'open') for (const operation of ['writeFile', 'sync', 'close']) {
          const action = result[operation].bind(result)
          result[operation] = async (...values) => {
            const metric = target.fs[phase + ':' + operation] ??= { count: 0, totalMs: 0 }, began = now(); metric.count++
            try { return await action(...values) } finally { metric.totalMs += now() - began }
          }
        }
        return result
      } finally { target.fs[label].totalMs += now() - start }
    }
  }
  const stringify = JSON.stringify
  JSON.stringify = function(value, ...args) {
    const start = now(), result = stringify(value, ...args)
    if (value?.version === 1 && Array.isArray(value.items)) stats.stringifyMs += now() - start
    return result
  }
  const spawn = cp.spawn
  cp.spawn = function(binary, ...args) {
    const target = stats, name = path.basename(binary).replace('.exe', ''), child = spawn(binary, ...args)
    target.processes[name] = (target.processes[name] ?? 0) + 1
    children++; target.processes.peak = Math.max(children, target.processes.peak)
    child.once('close', () => children--)
    return child
  }
  const load = Module._load
  Module._load = function(request, ...args) {
    if (request === '../engineReadiness') return { engineReceipts: { ensure: async () => ({ available: true }) } }
    if (request === '../paths') return { getBinaryPath: name => path.join(root, 'engine-baseline', name + '.exe') }
    if (request === 'electron') return { ...load.call(this, request, ...args), dialog: { showOpenDialog: async () => {
      const start = now(); await new Promise(resolve => setTimeout(resolve, 150)); pickerMs = now() - start
      return { canceled: false, filePaths: selected }
    } } }
    return load.call(this, request, ...args)
  }
  const { MediaLibrary } = require(path.join(root, 'Back-End/electron/mediaLibrary.ts'))
  const { AudioArtwork } = require(path.join(root, 'Back-End/electron/audioArtwork.ts'))
  const { LibraryThumbnails } = require(path.join(root, 'Back-End/electron/libraryThumbnails.ts'))
  const ipc = require(path.join(root, 'Back-End/electron/ipc/mediaLibraryIpc.ts'))
  Module._load = load
  let libraryInstance
  const addMethod = MediaLibrary.prototype.add
  MediaLibrary.prototype.add = function(...args) { stats.validationStart = now(); return addMethod.apply(this, args) }
  const catalogMethod = MediaLibrary.prototype.catalog
  MediaLibrary.prototype.catalog = function(...args) { libraryInstance = this; return catalogMethod.apply(this, args) }
  for (const [type, name, label] of [[MediaLibrary, 'save', 'saveMs'], [AudioArtwork, 'coverStream', 'probes'], [LibraryThumbnails, LibraryThumbnails.prototype.getInfo ? 'getInfo' : 'get', 'thumbnails']]) {
    const original = type.prototype[name]
    type.prototype[name] = async function(...args) {
      const target = stats, start = now()
      if (label === 'saveMs' && target.validationStart) target.validationWallMs = start - target.validationStart
      try { return await original.apply(this, args) }
      finally { const ms = now() - start; if (Array.isArray(target[label])) target[label].push({ start, ms }); else target[label] += ms }
    }
  }
  const inspect = MediaLibrary.prototype.inspectFile
  MediaLibrary.prototype.inspectFile = async function(...args) {
    const target = stats, start = now(); inspections++; target.inspectPeak = Math.max(target.inspectPeak, inspections)
    try { return await inspect.apply(this, args) } finally { inspections--; target.inspectMs += now() - start }
  }
  const handle = ipcMain.handle.bind(ipcMain), channels = new Set()
  ipcMain.handle = (channel, action) => {
    if (channels.has(channel)) ipcMain.removeHandler(channel)
    channels.add(channel)
    handle(channel, async (...args) => {
      const target = stats, start = now()
      if (channel.endsWith(':add') || channel.endsWith(':select')) phase = 'import'
      try { return await action(...args) }
      finally {
        const end = now(); target.handlers.push({ channel, start, end, ms: end - start })
        if (channel.endsWith(':add') || channel.endsWith(':select')) phase = 'artwork'
      }
    })
  }
  handle('benchmark:clock', () => now())
  await app.whenReady()
  const win = new BrowserWindow({ show: false, width: 1080, height: 850, webPreferences: { nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false } })
  ipc.registerMediaLibraryIpc(() => win)
  const js = code => win.webContents.executeJavaScript(code)
  await win.loadFile(path.join(directory, 'index.html'))
  while (!await js('window.benchmark?.ready()')) await new Promise(resolve => setTimeout(resolve, 10))
  const clock = await js('window.benchmark.calibrate()')
  const files = JSON.parse(await fs.readFile(path.join(directory, 'files.json'), 'utf8')), runs = []
  for (const count of [1, 3, 100, 1200]) {
    await ipc.stopLibraryThumbnails(); ipc.registerMediaLibraryIpc(() => win)
    assert.ok(path.resolve(libraryInstance.file).startsWith(path.resolve(directory) + path.sep))
    libraryInstance.entries = []; libraryInstance.statuses.clear()
    await fs.unlink(libraryInstance.file).catch(error => { if (error.code !== 'ENOENT') throw error })
    await fs.rm(path.join(directory, 'profile/library-thumbnails'), { recursive: true, force: true })
    stats = fresh(); phase = 'import'
    const timing = await js('window.benchmark.run(' + JSON.stringify(files.slice(0, count)) + ')')
    // Drain all requests on the first page before measuring or clearing a cache.
    for (let n = 0; n < 200 && children; n++) await new Promise(resolve => setTimeout(resolve, 10))
    await new Promise(resolve => setTimeout(resolve, 100))
    const importHandler = stats.handlers.find(entry => entry.channel.endsWith(':add'))
    runs.push({ catalogCount: count, addedCount: count, timing, requestTransferMs: importHandler.start - timing.requestSent,
      responseTransferMs: timing.responseReceived - importHandler.end, firstCardMs: timing.cardPainted - timing.start,
      firstImageMs: timing.hasImage ? timing.imagePainted - timing.start : null, ...stats })
  }
  // Fresh standalone catalogs measure full validation + atomic commit for each size.
  const imports = []
  for (const count of [1, 3, 100, 1200]) {
    stats = fresh(); phase = 'import'
    const library = new MediaLibrary(path.join(directory, 'fresh-' + count + '.json')), start = now()
    const result = await library.add(files.slice(0, count)), ms = now() - start
    assert.equal(result.added, count)
    const duplicateStart = now(), duplicate = await library.add(files.slice(0, count)), duplicateMs = now() - duplicateStart
    assert.equal(duplicate.duplicates, count)
    imports.push({ count, ms, duplicateMs, ...stats })
  }
  await ipc.stopLibraryThumbnails(); ipc.registerMediaLibraryIpc(() => win)
  stats = fresh(); phase = 'warm'
  const catalog = await new MediaLibrary(path.join(directory, 'profile/media-library.json')).catalog()
  const warmItem = catalog[0]
  // Seed an exact entry before recreating workers, independent of sort ties/viewport.
  await js('window.cortexDl.getMediaLibraryArtworkInfo(' + JSON.stringify(warmItem.id) + ')')
  await ipc.stopLibraryThumbnails(); ipc.registerMediaLibraryIpc(() => win)
  stats = fresh(); phase = 'warm'
  const warmStart = now()
  await js('window.cortexDl.getMediaLibraryArtworkInfo(' + JSON.stringify(warmItem.id) + ')')
  const warm = { ms: now() - warmStart, ...stats }
  selected = [files[0]]; stats = fresh(); phase = 'picker'
  const picker = await js('window.benchmark.run()')
  await ipc.stopLibraryThumbnails()
  const result = { baseline: baseline || null, clock, environment: { electron: process.versions.electron, node: process.versions.node, platform: process.platform },
    method: 'Real Electron IPC, production React/Zustand/components, real FFmpeg/FFprobe, local generated media. Engine readiness stubbed; no hash/download overhead. Picker is a 150ms controlled dialog fixture; actual human/native picker duration is unmeasured. Card/image paint sampled after two animation frames.',
    runs, imports, warm, picker: { controlledDialogMs: pickerMs, ...picker } }
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
  win.destroy(); app.quit()
}
if (process.versions.electron) electronBenchmark().catch(error => { console.error(error); require('electron').app.exit(1) })
else launcher().catch(error => { console.error(error); process.exitCode = 1 })
