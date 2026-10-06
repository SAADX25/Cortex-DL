const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')))
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
function verifyVersion(tag) {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(lock.version, pkg.version, 'Lockfile version mismatch')
  assert.equal(lock.packages[''].version, pkg.version, 'Root lockfile version mismatch')
  if (tag) assert.equal(tag, `v${pkg.version}`, 'Tag must equal package version')
}
async function main() {
  const strict = process.argv.includes('--release')
  verifyVersion(process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined)
  if (strict) {
    assert.equal(git('status', '--porcelain'), '', 'Release build requires a clean committed tree')
    verifyVersion(git('describe', '--tags', '--exact-match', 'HEAD'))
  }
  if (process.argv.includes('--artifacts')) {
    const dir = path.join(root, 'release', pkg.version)
    const name = `Cortex-DL-Setup-${pkg.version}.exe`
    const yaml = require('js-yaml').load(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'))
    assert.equal(yaml.version, pkg.version)
    assert.equal(yaml.path, name)
    const info = yaml.files.find(file => file.url === name)
    assert.ok(info, 'Installer missing in latest.yml')
    const file = path.join(dir, name)
    assert.equal(info.size, fs.statSync(file).size)
    const hash = crypto.createHash('sha512')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    assert.equal(info.sha512, hash.digest('base64'))
    assert.equal(yaml.sha512, info.sha512)
    assert.ok(fs.statSync(`${file}.blockmap`).size > 0)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'win-unpacked/resources/build-manifest.json')))
    assert.equal(manifest.version, pkg.version)
    assert.equal(manifest.commit, git('rev-parse', 'HEAD'))
    assert.equal(manifest.dirty, false, 'Candidate is not publishable until committed and rebuilt')
    if (process.platform === 'win32') {
      const exe = path.join(dir, 'win-unpacked', 'Cortex DL.exe').replace(/'/g, "''")
      const metadata = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe}').VersionInfo.FileVersion`], { encoding: 'utf8' }).trim()
      assert.equal(metadata, pkg.version, 'Windows executable metadata version mismatch')
    }
  }
  console.log(`Release version ${pkg.version} verified`)
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { verifyVersion }
