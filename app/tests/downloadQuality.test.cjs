require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
global.localStorage = { getItem: () => null, setItem() {} }
const { useUIStore } = require('../Front-End/src/stores/useUIStore.ts')
const { useFormStore } = require('../Front-End/src/stores/useFormStore.ts')
const { handleAnalyzeUrlDirectly, onDownloadNow } = require('../Front-End/src/actions/downloadActions.ts')
const { primaryAnalysis } = require('../Front-End/src/lib/analysisSession.ts')
const result = { kind: 'ytdlp', title: '4K video', thumbnail: 'https://fixture.invalid/thumbnail',
  formats: [144, 360, 720, 1080, 1440, 2160].map(height => ({ formatId: String(height), height, fps: 24 })) }
function prepare(analyzeUrl) {
  primaryAnalysis.cancel()
  useUIStore.setState({ url: '', analyzing: false, analyzeResult: null, directory: 'C:\\Downloads', showToast() {} })
  useFormStore.setState({ selectedQuality: '720p', selectedYtdlpFormatId: '720p' })
  global.window = { cortexDl: { analyzeUrl, onAnalysisUpdate: () => () => {}, cancelAnalysis: async () => {} } }
}

test('new video analysis clears the previous low quality and downloads with best auto', async () => {
  prepare(async () => structuredClone(result))
  let input
  window.cortexDl.addDownload = async value => { input = value }
  await handleAnalyzeUrlDirectly('https://youtube.com/watch?v=abcdefghijk')
  assert.equal(useFormStore.getState().selectedQuality, '')
  assert.equal(useFormStore.getState().selectedYtdlpFormatId, null)
  await onDownloadNow()
  assert.equal(input.ytdlpFormatId, undefined, 'previous 720p must not limit the new video')
})

test('a quality chosen during analysis remains selected when full formats arrive', async () => {
  let finish
  prepare(() => new Promise(resolve => { finish = resolve }))
  const analysis = handleAnalyzeUrlDirectly('https://youtube.com/watch?v=abcdefghijk')
  useFormStore.setState({ selectedQuality: '1080p', selectedYtdlpFormatId: '1080p' })
  finish(structuredClone(result))
  await analysis
  assert.equal(useFormStore.getState().selectedQuality, '1080p')
  assert.equal(useFormStore.getState().selectedYtdlpFormatId, '1080p')
})
