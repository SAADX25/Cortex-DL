const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const version = require('../package.json').version
async function run(exe, directory, offline = false) {
  await new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(exe, ['--packaged-smoke', ...(offline ? ['--smoke-offline'] : []), `--smoke-dir=${directory}`], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-65536) })
    child.stderr.on('data', chunk => { output = (output + chunk.toString()).slice(-65536) })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Packaged app did not really quit within 300 seconds')) }, 300000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { require('node:fs').writeFileSync(path.join(directory, 'process-output.txt'), output); clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Packaged exit ${code}`)) })
  })
  const failure = await fs.readFile(path.join(directory, 'failure.txt'), 'utf8').catch(() => null)
  assert.equal(failure, null, failure)
  const marker = JSON.parse(await fs.readFile(path.join(directory, 'startup-state.json')))
  assert.equal(marker.state, 'clean-shutdown')
}
async function main() {
  const exe = process.argv[2] || path.join(root, 'release', version, 'win-unpacked', 'Cortex DL.exe')
  const directory = await fs.mkdtemp(path.join(root, 'smoke-results', 'Windows spaces العربية-'))
  const started = Date.now()
  await run(exe, directory)
  const firstMs = Date.now() - started
  // Engines are downloaded separately; repairing a corrupt executable needs network.
  await fs.mkdir(path.join(directory, 'bin'), { recursive: true })
  await fs.writeFile(path.join(directory, 'bin', 'ffmpeg.exe'), 'corrupt fixture')
  const restart = Date.now(); await run(exe, directory)
  const result = JSON.parse(await fs.readFile(path.join(directory, 'second-run.json')))
  assert.equal(result.restored, true)
  assert.ok((await fs.stat(path.join(directory, 'bin/ffmpeg.exe'))).size > 100000, 'Broken override must be repaired')
  // Once provisioned, healthy engines must work without network.
  await run(exe, directory, true)
  console.log(JSON.stringify({ directory, firstRunMs: firstMs, restartMs: Date.now() - restart, ...result }, null, 2))
}
fs.mkdir(path.join(root, 'smoke-results'), { recursive: true }).then(main).catch(error => { console.error(error); process.exitCode = 1 })
