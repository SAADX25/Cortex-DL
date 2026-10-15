const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  try { return originalResolve.call(this, request, parent, ...rest) }
  catch (error) {
    if (request.startsWith('.') && fs.existsSync(path.resolve(path.dirname(parent.filename), request + '.ts')))
      return originalResolve.call(this, request + '.ts', parent, ...rest)
    throw error
  }
}
require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  module._compile(code, filename)
}


const nodeTest = require('node:test')
exports.suite = (name, define) => nodeTest(name, { concurrency: false }, async context => {
  const load = Module._load
  const resolve = Module._resolveFilename
  const cached = new Set(Object.keys(require.cache))
  const globals = new Map(['window', 'document', 'localStorage', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const cases = []
  try {
    define((...args) => cases.push(args))
    for (const args of cases) await context.test(...args)
  } finally {
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    Module._load = load
    Module._resolveFilename = resolve
    for (const file of Object.keys(require.cache)) if (!cached.has(file)) delete require.cache[file]
  }
})
