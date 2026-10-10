const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { cleanProject } = require('../scripts/clean.cjs')

async function fixture(work) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-clean-'))
  const app = path.join(directory, 'app')
  await fs.mkdir(app)
  await fs.writeFile(path.join(app, 'package.json'), '{"name":"cortex-dl"}')
  const files = [
    'dist-electron/main.js', 'Front-End/dist/index.html', 'smoke-results/fixture/bin/ffmpeg.exe',
    'bin/ffmpeg.exe', 'build-manifest.json', 'THIRD-PARTY-NOTICES.txt',
    'release/2.2.0/win-unpacked/app.exe', 'release/2.2.0/Cortex-DL-Setup-2.2.0.exe',
    'release/2.2.0/latest.yml', 'release/2.2.0/Cortex-DL-Setup-2.2.0.exe.blockmap',
    'build/installer.nsh', 'Front-End/src/App.tsx', 'Back-End/electron/main.ts',
    '.cortex_temp/paused/partial.part', '.env', 'node_modules/fixture/index.js',
    'engine-baseline/ffmpeg.exe', 'engine-baseline/FFmpeg.download',
  ]
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(app, file)), { recursive: true })
    await fs.writeFile(path.join(app, file), file)
  }
  try { await work(app, directory, files) }
  finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('cleanup preview changes nothing; cleanup preserves source, dependencies, engines, partials and installers', () => fixture(async (app, _directory, files) => {
  const plan = await cleanProject(app, { dryRun: true })
  assert.ok(plan.reduce((sum, entry) => sum + entry.bytes, 0) > 0)
  for (const file of files) assert.equal(await fs.readFile(path.join(app, file), 'utf8'), file)
  await cleanProject(app)
  for (const file of files) {
    const removed = plan.some(entry => path.join(app, file) === entry.target || path.join(app, file).startsWith(entry.target + path.sep))
    if (removed) await assert.rejects(fs.stat(path.join(app, file)), { code: 'ENOENT' })
    else assert.equal(await fs.readFile(path.join(app, file), 'utf8'), file)
  }
  await cleanProject(app) // Missing outputs are safe on repeated runs.
  await fs.stat(path.join(app, 'release/2.2.0/win-unpacked/app.exe'))
  await cleanProject(app, { packaged: true })
  await assert.rejects(fs.stat(path.join(app, 'release/2.2.0/win-unpacked')), { code: 'ENOENT' })
  for (const file of ['Cortex-DL-Setup-2.2.0.exe', 'latest.yml', 'Cortex-DL-Setup-2.2.0.exe.blockmap']) await fs.stat(path.join(app, 'release/2.2.0', file))
}))

test('cleanup refuses redirected parents or nested junctions before deleting outputs', () => fixture(async (app, directory) => {
  const outside = path.join(directory, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'keep.txt'), 'preserve')
  const link = path.join(app, 'smoke-results', 'redirected')
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(cleanProject(app), /linked path/)
  await fs.stat(path.join(app, 'dist-electron/main.js'))
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'preserve')
  await fs.unlink(link)
  await fs.rm(path.join(app, 'release'), { recursive: true })
  await fs.symlink(outside, path.join(app, 'release'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(cleanProject(app, { packaged: true }), /linked path/)
  await fs.stat(path.join(app, 'dist-electron/main.js'))
}))

test('cleanup refuses an unrelated project', () => fixture(async app => {
  await fs.writeFile(path.join(app, 'package.json'), '{"name":"other-app"}')
  await assert.rejects(cleanProject(app), /Cortex DL app directory/)
  await fs.stat(path.join(app, 'dist-electron/main.js'))
}))
