const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const pkg = require('../package.json')
const engines = JSON.parse(fs.readFileSync(path.join(root, 'engine-baseline/manifest.json')))
const manifest = {
  version: pkg.version,
  commit: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain') !== '',
  buildDate: new Date(Number(git('show', '-s', '--format=%ct', 'HEAD')) * 1000).toISOString(),
  electron: require('electron/package.json').version,
  engines: Object.fromEntries(engines.engines.map(e => [e.name, e.version])),
}
fs.writeFileSync(path.join(root, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(manifest)
