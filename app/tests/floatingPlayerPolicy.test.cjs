require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module'), { EventEmitter } = require('node:events')
const originalLoad = Module._load, external = []
Module._load = function (name, ...args) {
  if (name === 'electron') return { screen: { getDisplayMatching: () => ({ workArea: { x: 100, y: 100, width: 1200, height: 800 } }) }, shell: { openExternal: async url => { external.push(url) } } }
  return originalLoad.call(this, name, ...args)
}
const { installFloatingPlayerWindow } = require('../Back-End/electron/floatingPlayer.ts')
Module._load = originalLoad

test('floating window policy permits one trusted surface, blocks navigation and restores background throttling', () => {
  const owner = { getBounds: () => ({}), webContents: new EventEmitter() }, content = owner.webContents
  let handler, childHandler, throttled = true, menu
  Object.assign(content, { setWindowOpenHandler: value => { handler = value }, getBackgroundThrottling: () => throttled, setBackgroundThrottling: value => { throttled = value }, isDestroyed: () => false })
  installFloatingPlayerWindow(owner)
  const request = { url: 'about:blank', frameName: 'cortex-floating-player' }
  const result = handler(request)
  assert.equal(result.action, 'allow'); assert.equal(result.overrideBrowserWindowOptions.alwaysOnTop, true)
  assert.equal(result.overrideBrowserWindowOptions.frame, false, 'Floating player must use one integrated header')
  assert.equal(result.overrideBrowserWindowOptions.webPreferences, undefined, 'About-blank window must inherit the protected renderer preferences')
  assert.equal(handler({ ...request, frameName: 'other' }).action, 'deny')
  assert.equal(handler({ ...request, url: 'file:///private.txt' }).action, 'deny')
  assert.equal(handler({ ...request, url: 'https://example.test/' }).action, 'deny'); assert.deepEqual(external, ['https://example.test/'])
  const child = new EventEmitter(); child.webContents = new EventEmitter(); child.setMenu = value => { menu = value }
  child.webContents.setWindowOpenHandler = value => { childHandler = value }
  content.emit('did-create-window', child, { frameName: request.frameName })
  assert.equal(menu, null); assert.equal(throttled, false); assert.equal(handler(request).action, 'deny'); assert.equal(childHandler(request).action, 'deny')
  for (const name of ['will-navigate', 'will-redirect']) { let prevented = false; child.webContents.emit(name, { preventDefault: () => { prevented = true } }); assert.equal(prevented, true) }
  child.emit('closed'); assert.equal(throttled, true); assert.equal(handler(request).action, 'allow')
})
