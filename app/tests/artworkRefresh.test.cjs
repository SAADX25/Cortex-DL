require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path')
const Module = require('node:module'), originalLoad = Module._load
const calls = []
let failure = null
Module._load = function(request, ...args) {
  if (request === 'node:child_process') return {
    execFile: (binary, args, options, callback) => { calls.push({ binary, args, options }); callback(failure) },
  }
  return originalLoad.call(this, request, ...args)
}
const { refreshArtworkFile } = require('../Back-End/electron/artworkRefresh.ts')
Module._load = originalLoad

test('Windows artwork refresh sends a bounded per-file Unicode notification without executing filenames', async () => {
  const file = path.resolve('غلاف $([dangerous]) `quoted` & name.mp3')
  const refreshed = await refreshArtworkFile(file)
  if (process.platform !== 'win32') {
    assert.equal(refreshed, false); assert.equal(calls.length, 0); return
  }
  assert.equal(refreshed, true)
  const { binary, args, options } = calls.at(-1)
  assert.equal(binary, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  assert.deepEqual(args.slice(0, -1), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
  assert.ok(!script.includes(file)); assert.ok(!args.includes(file))
  assert.match(script, /CharSet = CharSet.Unicode/)
  assert.match(script, /SHChangeNotify\(0x00002000, 0x00002005, \$env:CORTEX_ARTWORK_FILE, \[IntPtr\]::Zero\)/)
  assert.equal(options.env.CORTEX_ARTWORK_FILE, file)
  assert.equal(options.windowsHide, true); assert.equal(options.timeout, 5000); assert.equal(options.maxBuffer, 8192)
  assert.ok(!options.shell)
  const count = calls.length
  assert.equal(await refreshArtworkFile('relative.mp3'), false)
  assert.equal(await refreshArtworkFile(file + '\0'), false)
  assert.equal(calls.length, count)
  failure = new Error('PowerShell is blocked')
  assert.equal(await refreshArtworkFile(file), false, 'Refresh is optional when PowerShell fails or times out')
})
