// Isolated fixture userData only. Refuse to modify preexisting user data.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const version = require('../package.json').version
const install = path.join(root, 'installer-validation', 'Cortex spaces العربية')
const data = path.join(process.env.APPDATA, 'Cortex DL')
function launch(exe, args, env = process.env) {
  const result = spawnSync(exe, args, { windowsHide: true, timeout: 240000, encoding: 'utf8', env })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stdout + result.stderr)
}
function snapshot(dir, result = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) snapshot(file, result)
    else result[path.relative(data, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }
  return result
}
assert.equal(fs.existsSync(data), false, 'Upgrade fixture requires absent real Cortex DL userData; use a separate Windows user when it exists')
fs.mkdirSync(data, { recursive: true })
fs.mkdirSync(path.join(data, 'bin'))
fs.writeFileSync(path.join(data, 'bin', 'engine-state.fixture'), 'preserved engine state')
const fixture = path.join(root, 'installer-validation', 'seed-legacy.cjs')
fs.mkdirSync(path.dirname(fixture), { recursive: true })
fs.writeFileSync(fixture, `
const Database=require(${JSON.stringify(path.join(install, 'resources/app.asar/node_modules/better-sqlite3'))});
const db=new Database(${JSON.stringify(path.join(data, 'tasks.sqlite'))}); db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY,title TEXT,url TEXT,status TEXT,progress REAL,size INTEGER,thumbnail TEXT,engine TEXT,full_payload TEXT); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
const task={id:'upgrade-fixture',title:'Legacy history fixture',url:'https://example.invalid/fixture',directory:${JSON.stringify(path.join(root, 'installer-validation'))},filename:'fixture.mp4',engine:'direct',targetFormat:'mp4',status:'paused',downloadedBytes:1,totalBytes:2,createdAtMs:1,updatedAtMs:1};
db.prepare('INSERT INTO tasks(id,title,url,status,full_payload) VALUES(?,?,?,?,?)').run(task.id,task.title,task.url,task.status,JSON.stringify(task));
for(const [key,value] of [['downloadDirectory',task.directory],['cookieFilePath','C:\\\\fixture\\\\cookies.txt'],['credentialFixture','encrypted-fixture-bytes']]) db.prepare('INSERT INTO settings VALUES(?,?)').run(key,value);
db.close();
`)
let success = false
try {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  launch(path.join(root, 'release/2.1.0/Cortex DL Setup 2.1.0.exe'), ['/S', `/D=${install}`], env)
  fs.mkdirSync(path.join(data, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(data, 'bin', 'engine-state.fixture'), 'preserved engine state')
  launch(path.join(install, 'Cortex DL.exe'), [fixture], { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
  const before = snapshot(data)
  launch(path.join(root, `release/${version}/Cortex-DL-Setup-${version}.exe`), ['/S', `/D=${install}`], env)
  assert.deepEqual(snapshot(data), before, `2.1.0 → ${version} must preserve history/settings/cookies/credential bytes and engine state`)
  assert.equal(fs.existsSync(data + '.upgrade-2.1.5-backup'), false)
  const check = path.join(root, 'installer-validation', 'check-upgrade.cjs')
  fs.writeFileSync(check, `const Database=require(${JSON.stringify(path.join(install, 'resources/app.asar/node_modules/better-sqlite3'))});const db=new Database(${JSON.stringify(path.join(data, 'tasks.sqlite'))});if(db.prepare('SELECT count(*) AS n FROM tasks').get().n!==1||db.pragma('quick_check',{simple:true})!=='ok')process.exit(1);db.close();`)
  launch(path.join(install, 'Cortex DL.exe'), [check], { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
  success = true
  console.log(`Real NSIS 2.1.0 → ${version} upgrade passed; legacy database readable under Electron 44; all fixture data hashes preserved`)
} finally {
  // Only delete this script's fixture, and only after proving successful preservation.
  if (success && path.resolve(data) === path.resolve(path.join(process.env.APPDATA, 'Cortex DL'))) fs.rmSync(data, { recursive: true })
}
