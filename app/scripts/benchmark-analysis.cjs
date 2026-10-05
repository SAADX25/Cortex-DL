// Deterministic extraction + optional-service latency fixture; never contacts a provider.
require('../tests/register-ts.cjs')
const Module = require('node:module')
const cp = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
const original = Module._load
const info = { id:'abcdefghijk', title:'fixture', duration:60, formats:[] }
let spawns = 0
Module._load = function(request, parent, ...rest) {
  if (request === 'electron-log') return { info(){}, warn(){}, error(){} }
  if (request === './db') return { db:{prepare:()=>({get:()=>undefined})} }
  if (request === './paths') return { getBinaryPath:()=>process.execPath, getBinDirectory:()=>os.tmpdir() }
  if (request === 'node:child_process') return { ...cp, spawn(binary,args,options) {
    if (!args.includes('--dump-single-json')) return cp.spawn(binary,args,options)
    spawns++
    return cp.spawn(process.execPath,['-e',`setTimeout(()=>console.log(${JSON.stringify(JSON.stringify(info))}),20)`],options)
  } }
  if (request === 'node:https') return { get(_url,_options,callback) {
    const request=new EventEmitter()
    setTimeout(()=>{
      const response=new EventEmitter();response.statusCode=200;response.headers={}
      callback(response);response.emit('data',JSON.stringify({dislikes:10}));response.emit('end')
    },250)
    return request
  } }
  return original.call(this,request,parent,...rest)
}
async function main() {
  const filename=path.join(process.cwd(),'Back-End/electron/ytdlp.ts')
  const baseline=cp.execFileSync('git',['show','28f8831:app/Back-End/electron/ytdlp.ts'],{encoding:'utf8'})
  const oldModule=new Module(filename,module);oldModule.filename=filename;oldModule.paths=module.paths
  oldModule._compile(ts.transpileModule(baseline,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
  const current=require(filename)
  const measure=async(fn,label)=>{
    const times=[]
    for(let i=0;i<6;i++) {
      const start=performance.now()
      await fn(`https://www.youtube.com/watch?v=abcdefghijk&benchmark=${label}${i}`)
      if(i) times.push(Number((performance.now()-start).toFixed(2)))
    }
    return {samplesMs:times,meanMs:Number((times.reduce((sum,n)=>sum+n,0)/times.length).toFixed(2))}
  }
  const before=await measure(oldModule.exports.analyzeWithYtdlp,'old')
  const after=await measure(current.analyzeWithYtdlp,'new')
  const prior=spawns
  const start=performance.now()
  await Promise.all([current.analyzeWithYtdlp('https://youtu.be/lmnopqrstuv'),current.analyzeWithYtdlp('https://youtube.com/watch?v=lmnopqrstuv')])
  const simultaneousMs=performance.now()-start
  const deduplicatedProcesses=spawns-prior
  const cacheStart=performance.now();await current.analyzeWithYtdlp('https://youtu.be/lmnopqrstuv')
  process.stdout.write(JSON.stringify({fixture:{extractionDelayMs:20,optionalServiceDelayMs:250,warmupSamples:1},before,after,
    simultaneousMs:Number(simultaneousMs.toFixed(2)),deduplicatedProcesses,cachedMs:Number((performance.now()-cacheStart).toFixed(2))},null,2)+'\n')
}
main().catch(error=>{console.error(error);process.exitCode=1})
