require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const load = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === '../hooks/useHighFrequencyIPC') return { startHighFrequencyIPCListeners: () => () => {} }
  return load.call(this, request, parent, ...rest)
}
const { initDownloadStore, useDownloadStore } = require('../Front-End/src/stores/downloadStore.ts')
const tick = () => new Promise(resolve => setImmediate(resolve))

test('history retries after failed startup when engines become ready; completed items reappear', async () => {
  const listeners = new Set(), errors = [], error = console.error
  let calls = 0
  const saved = { id: 'completed', status: 'completed', title: 'Saved download' }
  global.window = { cortexDl: {
    listDownloads: async () => { if (++calls === 1) throw new Error('startup delayed'); return [saved] },
    onSetupProgress: listener => { listeners.add(listener); return () => listeners.delete(listener) },
  } }
  console.error = (...args) => errors.push(args)
  useDownloadStore.getState().loadTasks([])
  const dispose = initDownloadStore()
  try {
    await tick()
    assert.equal(errors.length, 1)
    for (const listener of listeners) listener({ status: 'checking' })
    assert.equal(calls, 1)
    for (const listener of listeners) listener({ status: 'ready' })
    await tick()
    assert.deepEqual(useDownloadStore.getState().tasks.get(saved.id), saved)
    assert.equal(calls, 2)
  } finally { dispose(); console.error = error }
  assert.equal(listeners.size, 0)
})

test('ready during a failing initial request still retries, and disposed requests cannot restore stale tasks', async () => {
  let rejectInitial, resolveRefresh, readyListener, calls = 0
  global.window = { cortexDl: {
    listDownloads: () => ++calls === 1 ? new Promise((_, reject) => { rejectInitial = reject }) : new Promise(resolve => { resolveRefresh = resolve }),
    onSetupProgress: listener => { readyListener = listener; return () => {} },
  } }
  const error = console.error
  console.error = () => {}
  useDownloadStore.getState().loadTasks([])
  const dispose = initDownloadStore()
  try {
    readyListener({ status: 'ready' })
    rejectInitial(new Error('timeout'))
    await tick()
    assert.equal(calls, 2)
    dispose()
    resolveRefresh([{ id: 'stale', status: 'completed' }])
    await tick()
    assert.equal(useDownloadStore.getState().tasks.size, 0)
  } finally { dispose(); console.error = error }
})
