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
