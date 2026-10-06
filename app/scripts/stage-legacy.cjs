require('../tests/register-ts.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { downloadEngine, sha256 } = require('../Back-End/electron/engineIntegrity.ts')
async function main() {
  const root = path.resolve(__dirname, '..', 'release', '2.1.0')
  await fs.mkdir(root, { recursive: true })
  const file = path.join(root, 'Cortex DL Setup 2.1.0.exe')
  const expected = '5893c49897417cd0f77bd7396fdf48364a178bfbeac1af2755cdd7f546175d5e'
  if (await sha256(file).catch(() => null) !== expected) await downloadEngine('https://github.com/SAADX25/Cortex-DL/releases/download/v2.1.0/Cortex-DL-Setup-2.1.0.exe', file, expected)
  console.log('Production 2.1.0 installer provenance verified')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
