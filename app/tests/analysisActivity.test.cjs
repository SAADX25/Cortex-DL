const { suite } = require('./register-ts.cjs')

suite('Analysis activity', test => {
  const assert = require('node:assert/strict')
  global.localStorage = { getItem: () => null, setItem() {} }
  const { useUIStore } = require('../Front-End/src/stores/useUIStore.ts')
  const { handleAnalyzeUrlDirectly } = require('../Front-End/src/actions/downloadActions.ts')
  const { primaryAnalysis } = require('../Front-End/src/lib/analysisSession.ts')
  const result = { kind: 'ytdlp', title: 'Video', formats: [{ formatId: '1080', height: 1080, fps: 30 }] }
  let listeners, requests
  function prepare() {
    primaryAnalysis.cancel()
    listeners = new Set(); requests = []
    useUIStore.setState({ url: '', analyzing: false, analysisStage: 'details', analyzeResult: null, globalError: null })
    global.window = { cortexDl: {
      onAnalysisUpdate(callback) { listeners.add(callback); return () => listeners.delete(callback) },
      cancelAnalysis: async () => {},
      analyzeUrl(url, id) { return new Promise((resolve, reject) => requests.push({ url, id, resolve, reject })) },
    } }
  }
  const update = (request, stage, data) => { for (const callback of listeners) callback({ id: request.id, stage, data }) }

  test('activity follows matching preview events and stays active until formats finish', async () => {
    prepare()
    const running = handleAnalyzeUrlDirectly('https://youtu.be/Szzcg2OD_Q4')
    assert.equal(useUIStore.getState().analyzing, true)
    assert.equal(useUIStore.getState().analysisStage, 'details')
    update({ id: 'unrelated-request' }, 'preview', { title: 'Stale' })
    update(requests[0], 'enrichment', { dislikes: 42 })
    assert.equal(useUIStore.getState().analysisStage, 'details')
    update(requests[0], 'preview', { title: 'Preview arrived' })
    assert.equal(useUIStore.getState().analysisStage, 'formats')
    assert.equal(useUIStore.getState().analyzing, true)
    assert.equal(useUIStore.getState().analyzeResult.preview, true)
    requests[0].resolve(structuredClone(result)); await running
    assert.equal(useUIStore.getState().analyzing, false)
    assert.equal(useUIStore.getState().analyzeResult.formats[0].height, 1080)
  })

  test('an old response cannot stop a replacement animation, and failures clear the preview', async () => {
    prepare()
    const old = handleAnalyzeUrlDirectly('https://youtu.be/Szzcg2OD_Q4')
    update(requests[0], 'preview', { title: 'Old preview' })
    const current = handleAnalyzeUrlDirectly('https://youtu.be/abcdefghijk')
    assert.equal(useUIStore.getState().analysisStage, 'details')
    update(requests[0], 'preview', { title: 'Stale preview' })
    requests[0].resolve(structuredClone(result)); await old
    assert.equal(useUIStore.getState().analyzing, true)
    assert.equal(useUIStore.getState().analysisStage, 'details')
    update(requests[1], 'preview', { title: 'Current preview' })
    assert.equal(useUIStore.getState().analysisStage, 'formats')
    requests[1].reject(new Error('YOUTUBE_RATE_LIMITED')); await current
    assert.equal(useUIStore.getState().analyzing, false)
    assert.equal(useUIStore.getState().analyzeResult, null)
    assert.ok(useUIStore.getState().globalError)
  })

  test('clearing the URL cancels the animation and ignores late preview or format results', async () => {
    prepare()
    const running = handleAnalyzeUrlDirectly('https://youtu.be/Szzcg2OD_Q4')
    update(requests[0], 'preview', { title: 'Preview' })
    useUIStore.getState().setUrl('')
    assert.equal(useUIStore.getState().analyzing, false)
    assert.equal(useUIStore.getState().analysisStage, 'details')
    update(requests[0], 'preview', { title: 'Late preview' })
    requests[0].resolve(structuredClone(result)); await running
    assert.equal(useUIStore.getState().analyzeResult, null)
    assert.equal(useUIStore.getState().analyzing, false)
  })
})
