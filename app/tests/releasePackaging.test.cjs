const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const asar = require('@electron/asar')
const { verifyDistribution } = require('../scripts/license-gate.cjs')

async function fixture(fn, bundledInAsar = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-release-'))
  try {
    const source = path.join(directory, 'source')
    const resources = path.join(directory, 'resources')
    await fs.mkdir(source)
    await fs.mkdir(resources)
    await fs.writeFile(path.join(source, 'package.json'), '{}')
    if (bundledInAsar) await fs.writeFile(path.join(source, 'ffmpeg.exe'), 'binary fixture')
    await asar.createPackage(source, path.join(resources, 'app.asar'))
    await fs.writeFile(path.join(resources, 'THIRD-PARTY-NOTICES.txt'), 'Dependency license notices')
    await fn(resources)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('release gate accepts a downloader package with notices and no redistributed engines', () => fixture(async resources => {
  assert.deepEqual(verifyDistribution(resources, { reviewed: false }), [])
  await fs.unlink(path.join(resources, 'THIRD-PARTY-NOTICES.txt'))
  assert.throws(() => verifyDistribution(resources, { reviewed: false }))
}))

test('release gate rejects an unreviewed engine in extra resources', () => fixture(async resources => {
  await fs.mkdir(path.join(resources, 'engines'))
  await fs.writeFile(path.join(resources, 'engines', 'ffmpeg.exe'), 'binary fixture')
  assert.throws(() => verifyDistribution(resources, { reviewed: false }), /redistribution review is incomplete/)
  assert.throws(() => verifyDistribution(resources, { reviewed: true }), /source archive is required/)
}))

test('release gate rejects an unreviewed engine hidden inside ASAR', () => fixture(async resources => {
  assert.throws(() => verifyDistribution(resources, { reviewed: false }), /redistribution review is incomplete/)
}, true))
