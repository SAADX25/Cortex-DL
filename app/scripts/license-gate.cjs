const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const engineFile = /^(?:yt-dlp|ffmpeg|ffprobe|deno)(?:\.exe|\.zip|\.download)?$/i
function verifyDistribution(resources, record) {
  const asar = require('@electron/asar')
  assert.ok(fs.existsSync(path.join(resources, 'app.asar')), 'Packaged application is required for license validation')
  assert.ok(fs.statSync(path.join(resources, 'THIRD-PARTY-NOTICES.txt')).size > 0, 'Third-party notices must ship with the application')
  const files = []
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else files.push(file)
    }
  }
  walk(resources)
  files.push(...asar.listPackage(path.join(resources, 'app.asar')))
  const bundled = files.filter(file => engineFile.test(path.basename(file.replace(/\\/g, '/'))))
  if (bundled.length) {
    assert.equal(record.reviewed, true, 'Third-party binary redistribution review is incomplete')
    assert.ok(record.sourceArchive && record.sourceSha256, 'Exact corresponding source archive is required')
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(record.sourceArchive)).digest('hex'), record.sourceSha256)
  }
  return bundled
}
if (require.main === module) {
  const version = require('../package.json').version
  const resources = path.join(__dirname, '..', 'release', version, 'win-unpacked', 'resources')
  const bundled = verifyDistribution(resources, require('../license-compliance.json'))
  console.log(`Distribution license gate passed: ${bundled.length} bundled engine files; third-party notices verified`)
}
module.exports = { verifyDistribution }
