require('../register-ts.cjs')
const assert=require('node:assert/strict')
const Module=require('node:module')
const path=require('node:path')
const load=Module._load
const [mode,directory]=process.argv.slice(2)
Module._load=function(request,parent,...rest) {
  if(request==='electron') return {app:{isPackaged:false,getPath:()=>directory},Notification:{isSupported:()=>false}}
  if(request==='electron-log') return {info(){},warn(){},error(){}}
  return load.call(this,request,parent,...rest)
}
const {db,taskDb}=require('../../Back-End/electron/db.ts')
const {DownloadManager}=require('../../Back-End/electron/downloadManager.ts')
if(mode==='seed') {
  for(const status of ['queued','pausing','downloading','merging','converting','completed']) {
    const t={id:status,url:'https://example.com',directory,filename:'partial.mp4',filePath:path.join(directory,'partial.mp4'),engine:'direct',targetFormat:'mp4',status,downloadedBytes:100,totalBytes:100,speedBytesPerSec:12,errorMessage:null,createdAtMs:1,updatedAtMs:1,attemptId:'crashed',resumeDirectory:path.join(directory,'.cortex_temp',status,'crashed')}
    taskDb.upsertTask.run({id:status,title:status,url:t.url,status,progress:100,size:100,thumbnail:'',engine:'direct',full_payload:JSON.stringify(t)})
  }
  // Deliberately exit without closing/checkpointing SQLite, simulating abrupt shutdown.
  process.exit(0)
}
const manager=new DownloadManager()
assert.equal(manager.list().length,6)
for(const t of manager.list()) {assert.equal(t.status,'paused');assert.notEqual(t.overallProgress,100);assert.equal(t.speedBytesPerSec,null)}
for(const row of taskDb.getAllTasks.all()) assert.equal(JSON.parse(row.full_payload).status,'paused')
assert.equal(manager.getActiveCount(),0)
manager.flushPendingSave()
db.close()
console.log('Real SQLite WAL crash/restart recovery passed')
