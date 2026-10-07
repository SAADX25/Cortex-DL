require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { downloadEngine } = require('../Back-End/electron/engineIntegrity.ts')

test('engine download permits slow active transfers and bounds stalled bodies', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-engine-timeout-'))
  const originalFetch = globalThis.fetch
  const originalTimeout = globalThis.setTimeout
  // Accelerate production deadlines without changing the pacing of fixture data.
  globalThis.setTimeout = (callback, ms, ...args) => originalTimeout(callback,
    ms === 180_000 ? 30 : ms === 60_000 ? 200 : ms === 30 * 60_000 ? 2000 : ms === 500 || ms === 1000 ? 1 : ms, ...args)
  try {
    const bytes = Buffer.alloc(8192, 42)
    let requests = 0
    globalThis.fetch = async () => {
      requests++
      let offset = 0
      return new Response(new ReadableStream({
        async pull(controller) {
          await new Promise(resolve => originalTimeout(resolve, 40))
          controller.enqueue(bytes.subarray(offset, offset + 1024))
          offset += 1024
          if (offset === bytes.length) controller.close()
        },
      }), { headers: { 'Content-Length': String(bytes.length) } })
    }
    const destination = path.join(dir, 'engine')
    await downloadEngine('https://fixture.invalid/engine', destination, crypto.createHash('sha256').update(bytes).digest('hex'))
    assert.equal(requests, 1, 'An active download must not restart at the old deadline')
    assert.deepEqual(await fs.readFile(destination), bytes)

    let cancellations = 0
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1024)) },
      cancel() { cancellations++ },
    }))
    await assert.rejects(downloadEngine('https://fixture.invalid/stalled', path.join(dir, 'stalled')), /abort/i)
    assert.equal(cancellations, 3, 'Each stalled attempt must release its body')
    assert.deepEqual(await fs.readdir(dir), ['engine'], 'Failed attempts must remove partial files')
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalTimeout
    await fs.rm(dir, { recursive: true, force: true })
  }
})
