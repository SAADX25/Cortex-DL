require('../tests/register-ts.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { downloadEngine, sha256 } = require('../Back-End/electron/engineIntegrity.ts')
async function main() {
  const root = path.resolve(__dirname, '..', 'release', '2.1.0')
  await fs.mkdir(root, { recursive: true })
  const file = path.join(root, 'Cortex DL Setup 2.1.0.exe')
  const expected = '5893c49897417cd0f77bd7396fdf48364a178bfbeac1af2755cdd7f546175d5e'
  if (await sha256(file).catch(() => null) !== expected) {
    const url = 'https://github.com/SAADX25/Cortex-DL/releases/download/v2.1.0/Cortex-DL-Setup-2.1.0.exe'
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) })
    if (response.status === 404) {
      await fs.rm(file, { force: true })
      console.log('Historical 2.1.0 installer is no longer published; validate current installer installation/reinstallation instead')
      return
    }
    if (!response.ok) throw new Error(`Historical installer availability check failed: HTTP ${response.status}`)
    await downloadEngine(url, file, expected)
  }
  console.log('Production 2.1.0 installer provenance verified')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
