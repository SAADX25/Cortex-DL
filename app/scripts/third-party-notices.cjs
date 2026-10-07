const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
// npm.cmd requires a shell on Windows; this is fixed literal code with no user input.
const dirs = execFileSync(process.execPath, [npm, 'ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/)
const notices = []
for (const dir of new Set(dirs)) {
  if (dir === root) continue
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')))
  notices.push(`\n=== ${pkg.name} ${pkg.version} (${JSON.stringify(pkg.license || 'see upstream')}) ===\n`)
  for (const file of fs.readdirSync(dir).filter(name => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(name))) {
    const full = path.join(dir, file)
    if (fs.statSync(full).isFile()) notices.push(fs.readFileSync(full, 'utf8'))
  }
}
notices.push('\n=== Engines downloaded separately on first run ===\n')
for (const pkg of require('../engines.lock.json').packages) notices.push(`${pkg.name} ${pkg.version}: ${pkg.license}\n${pkg.url}\n`)
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'))
