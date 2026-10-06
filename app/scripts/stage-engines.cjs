require('../tests/register-ts.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { downloadEngine, extractEngineZip, sha256, verifyEngine, promoteEngine } = require('../Back-End/electron/engineIntegrity.ts')
const lock = require('../engines.lock.json')
async function main() {
  const root = path.resolve(__dirname, '..', 'engine-baseline')
  await fs.mkdir(root, { recursive: true })
  for (const notice of lock.notices) {
    const file = path.join(root, notice.filename)
    try { if (await sha256(file) !== notice.sha256) throw new Error('Mismatch') }
    catch { await fs.rm(file, { force: true }); await downloadEngine(notice.url, file, notice.sha256) }
  }
  const engines = []
  for (const pkg of lock.packages) {
    const archive = path.join(root, `${pkg.name}.download`)
    const stage = await fs.mkdtemp(path.join(root, 'stage-'))
    try {
      try { if (await sha256(archive) !== pkg.sha256) throw new Error('Mismatch') }
      catch { await fs.rm(archive, { force: true }); await downloadEngine(pkg.url, archive, pkg.sha256) }
      if (pkg.url.endsWith('.zip')) await extractEngineZip(archive, stage, pkg.engines.map(e => e.filename))
      else await fs.copyFile(archive, path.join(stage, pkg.engines[0].filename))
      for (const spec of pkg.engines) {
        const file = path.join(stage, spec.filename)
        const result = await verifyEngine(file, spec)
        if (!result.available) throw new Error(result.message)
        const entry = { ...spec, version: result.version, sha256: await sha256(file), source: pkg.url, packageSha256: pkg.sha256 }
        const final = path.join(root, spec.filename)
        const currentHash = await sha256(final).catch(() => null)
        if (currentHash !== entry.sha256) await promoteEngine(file, final, entry)
        engines.push(entry)
        console.log(`${spec.name} ${result.version} verified`)
      }
    } finally { await fs.rm(stage, { recursive: true, force: true }) }
  }
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ schema: 1, engines }, null, 2) + '\n')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
