const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, execFile } = require('node:child_process')
const root = path.resolve(__dirname, '..')
async function seed(directory) {
  const bin = path.join(directory, 'bin'); await fs.mkdir(bin, { recursive: true })
  const baseline = JSON.parse(await fs.readFile(path.join(root, 'engine-baseline/manifest.json'), 'utf8'))
  for (const engine of baseline.engines) {
    await fs.copyFile(path.join(root, 'engine-baseline', engine.filename), path.join(bin, engine.filename))
    await fs.writeFile(path.join(bin, `${engine.filename}.integrity.json`), JSON.stringify({ sha256: engine.sha256 }))
  }
}
async function launch(exe, prefix, directory, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }; delete env.ELECTRON_RUN_AS_NODE
  const started = Date.now()
  await new Promise((resolve, reject) => {
    const child = spawn(exe, [...prefix, '--startup-probe', '--smoke-offline', `--smoke-dir=${directory}`], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-65536) })
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-65536) })
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup probe timeout: ${exe}\n${output}`)) }, 90000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Startup exit ${code}\n${output}`)) })
  })
  const result = JSON.parse(await fs.readFile(path.join(directory, 'startup-timing.json')))
  assert.equal(result.state, 'ready')
  return { ...result, directory, processThroughShutdownMs: Date.now() - started,
    invocationToShownMs: result.wallTimes ? result.wallTimes.windowShownMs - started : null,
    shownToInteractiveMs: (result.timings?.firstUiRenderMs ?? result.firstUiMs) - result.uiMs }
}
async function devLauncher(directory) {
  const env = { ...process.env, CORTEX_STARTUP_PROBE_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE
  const started = Date.now()
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'Cortex_Dev.bat'], { cwd: path.dirname(root), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-65536) })
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-65536) })
    const timer = setTimeout(() => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      reject(new Error('Development launcher timeout\n' + output))
    }, 90000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Development launcher exit ' + code + '\n' + output)) })
  })
  const result = JSON.parse(await fs.readFile(path.join(directory, 'startup-timing.json')))
  assert.deepEqual(result.verification, { subprocesses: 0, hashReads: 0, bytesHashed: 0 })
  return { ...result, invocationToShownMs: result.wallTimes.windowShownMs - started,
    invocationToInteractiveMs: result.wallTimes.firstUiRenderMs - started,
    shownToInteractiveMs: result.timings.firstUiRenderMs - result.timings.windowShownMs,
    processThroughShutdownMs: Date.now() - started }
}
async function probe(exe, prefix, healthy = true) {
  const directory = await fs.mkdtemp(path.join(root, 'smoke-results', 'startup-'))
  await seed(directory)
  const migration = await launch(exe, prefix, directory)
  const second = await launch(exe, prefix, directory)
  if (healthy) {
    assert.deepEqual(second.verification, { subprocesses: 0, hashReads: 0, bytesHashed: 0 })
    assert.deepEqual(second.verificationBeforeUi, { subprocesses: 0, hashReads: 0, bytesHashed: 0 })
    assert.ok(second.timings.backgroundEngineStartMs >= second.timings.firstUiRenderMs)
    assert.ok(second.timings.updaterStartMs >= second.timings.firstUiRenderMs)
    assert.equal(second.uiSnapshot.shell, true)
    assert.equal(second.uiSnapshot.overlay, false)
    assert.ok(second.uiSnapshot.buttons > 0)
  }
  return { migration, second }
}
async function historyProbe(exe, directory) {
  const Database = require('better-sqlite3')
  const connection = new Database(path.join(directory, 'tasks.sqlite'))
  const insert = connection.prepare('INSERT INTO tasks (id, full_payload) VALUES (?, ?)')
  connection.transaction(() => {
    for (let i = 0; i < 500; i++) {
      const id = 'history-' + i
      insert.run(id, JSON.stringify({ id, url: 'https://fixture.invalid/media.mp4', status: 'paused', engine: 'direct',
        directory, filename: id + '.mp4', filePath: path.join(directory, id + '.mp4'), targetFormat: 'mp4',
        downloadedBytes: 0, totalBytes: null, createdAtMs: Date.now(), updatedAtMs: Date.now(), speedBytesPerSec: null, errorMessage: null }))
    }
  })()
  connection.close()
  const result = await launch(exe, [], directory)
  assert.deepEqual(result.verification, { subprocesses: 0, hashReads: 0, bytesHashed: 0 })
  return { records: 500, ...result }
}
async function main() {
  await fs.mkdir(path.join(root, 'smoke-results'), { recursive: true })
  const electron = path.join(root, 'node_modules/electron/dist/electron.exe')
  const beforeApp = path.join(root, 'smoke-results/startup-before/app')
  let before = null
  if (await fs.access(path.join(beforeApp, 'dist-electron/main.js')).then(() => true, () => false)) before = await probe(electron, [beforeApp], false)
  const compiledDevelopment = await probe(electron, [root])
  const packagedExe = path.join(root, 'release', require('../package.json').version, 'win-unpacked/Cortex DL.exe')
  const packaged = await probe(packagedExe, [])
  const packagedHistory = await historyProbe(packagedExe, packaged.second.directory)
  let installedBefore = null
  const installed = path.join(process.env.LOCALAPPDATA || '', 'Programs/Cortex DL/Cortex DL.exe')
  if (await fs.access(installed).then(() => true, () => false)) installedBefore = await probe(installed, [], false)
  // Run this last: Vite rebuilds dist-electron in development mode.
  const cortexDevBat = await devLauncher(compiledDevelopment.second.directory)
  const result = { note: 'Real Electron processes, verified binaries, migrated receipts then second healthy offline launch. Observations, not timing thresholds. Before snapshot adds only counters and first-interactive instrumentation. Installed baseline is unchanged; candidate runs its real packaged EXE from win-unpacked.', before, installedBefore, compiledDevelopment, packaged, packagedHistory, cortexDevBat }
  await fs.writeFile(path.join(root, 'smoke-results/startup-comparison.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
module.exports = { seed, launch, probe, devLauncher }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
