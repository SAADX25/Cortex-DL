const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
async function probe(exe, prefix) {
  const dir = await fs.mkdtemp(path.join(root, 'smoke-results', 'startup-'))
  // Measure normal offline startup after provisioning, not first-run downloads.
  const bin = path.join(dir, 'bin')
  await fs.mkdir(bin)
  const baseline = JSON.parse(await fs.readFile(path.join(root, 'engine-baseline/manifest.json'), 'utf8'))
  for (const engine of baseline.engines) {
    await fs.copyFile(path.join(root, 'engine-baseline', engine.filename), path.join(bin, engine.filename))
    await fs.writeFile(path.join(bin, `${engine.filename}.integrity.json`), JSON.stringify({ sha256: engine.sha256 }))
  }
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  await new Promise((resolve, reject) => {
    const child = spawn(exe, [...prefix, '--startup-probe', '--smoke-offline', `--smoke-dir=${dir}`], { env, windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Startup probe timeout')) }, 90000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Startup exit ${code}`)) })
  })
  const result = JSON.parse(await fs.readFile(path.join(dir, 'startup-timing.json')))
  assert.equal(result.state, 'ready')
  return result
}
async function main() {
  const compiledDevelopment = await probe(path.join(root, 'node_modules/electron/dist/electron.exe'), [root])
  const packaged = await probe(path.join(root, 'release', require('../package.json').version, 'win-unpacked/Cortex DL.exe'), [])
  const result = { note: 'Compiled development Electron runtime versus packaged with pre-provisioned engines; excludes first-run downloads and Vite startup. External fetch disabled.', compiledDevelopment, packaged }
  await fs.writeFile(path.join(root, 'smoke-results/startup-comparison.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
