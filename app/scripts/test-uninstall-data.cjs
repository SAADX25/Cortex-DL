// Compile and run the actual uninstall macro with APPDATA redirected to a
// disposable workspace fixture. Never install/uninstall the user's real app.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const parent = path.join(root, 'installer-validation')
fs.mkdirSync(parent, { recursive: true })
const fixture = fs.mkdtempSync(path.join(parent, 'uninstall-data-'))
assert.ok(path.relative(root, fixture).startsWith('installer-validation' + path.sep))
const makensis = process.argv[2]
assert.ok(makensis && fs.existsSync(makensis), 'Pass the path to the bundled makensis.exe')
const nsisQuote = text => text.replaceAll('$', () => '$$').replaceAll('"', '$\\"')
const profile = path.join(fixture, 'profile')
const exe = path.join(fixture, 'uninstall-fixture.exe')
const source = path.join(fixture, 'uninstall-fixture.nsi')
// Only substitute the destination root; compile the production control flow
// and deletion instructions directly, without accessing real AppData.
const include = path.join(fixture, 'installer.nsh')
const macro = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8').replaceAll('$APPDATA', nsisQuote(profile))
assert.ok(!macro.includes('$APPDATA'))
fs.writeFileSync(include, macro, 'utf8')
fs.writeFileSync(source, `
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Name "Cortex DL uninstall data fixture"
OutFile "${nsisQuote(exe)}"
RequestExecutionLevel user
SilentInstall silent
Var fixtureUpdated
Var fixtureDelete
Var installMode
!define isUpdated '$fixtureUpdated == "1"'
!define isDeleteAppData '$fixtureDelete == "1"'
!include "${nsisQuote(include)}"
Section
  StrCpy $installMode "CurrentUser"
  StrCpy $fixtureUpdated "0"
  StrCpy $fixtureDelete "0"
  \${GetParameters} $R0
  ClearErrors
  \${GetOptions} $R0 "--updated" $R1
  \${IfNot} \${Errors}
    StrCpy $fixtureUpdated "1"
  \${EndIf}
  ClearErrors
  \${GetOptions} $R0 "--delete-app-data" $R1
  \${IfNot} \${Errors}
    StrCpy $fixtureDelete "1"
  \${EndIf}
  !insertmacro customUnInstall
SectionEnd
`, 'utf8')
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
}
run(makensis, ['/V2', source])
const data = ['cortex-dl', 'Cortex DL']
const sentinel = path.join(profile, 'another-app', 'keep.txt')
fs.mkdirSync(path.dirname(sentinel), { recursive: true }); fs.writeFileSync(sentinel, 'keep')
const media = path.join(fixture, 'Downloads', 'song.mp3')
fs.mkdirSync(path.dirname(media), { recursive: true }); fs.writeFileSync(media, 'downloaded media')
for (const [mode, args, removed] of [
  ['keep data', ['/S'], false],
  ['update preserves data', ['/S', '--updated', '/KEEP_APP_DATA'], false],
  ['full uninstall', ['/S', '--delete-app-data'], true],
]) {
  for (const name of data) {
    const file = path.join(profile, name, 'bin', 'ffmpeg.exe')
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'engine sentinel')
    fs.writeFileSync(path.join(profile, name, 'tasks.sqlite'), 'history sentinel')
  }
  run(exe, args)
  for (const name of data) {
    assert.equal(fs.existsSync(path.join(profile, name)), !removed, mode + ': ' + name)
    if (!removed) assert.equal(fs.readFileSync(path.join(profile, name, 'bin', 'ffmpeg.exe'), 'utf8'), 'engine sentinel')
  }
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep')
  assert.equal(fs.readFileSync(media, 'utf8'), 'downloaded media')
  console.log('PASS: ' + mode)
}
console.log('Actual NSIS uninstall macro verified in: ' + fixture)
