import { app } from 'electron'
import { gotTheLock } from './bootstrap'
import { startupMark } from './startupTiming'

// Defer native DB and backend module evaluation until Electron is ready.
if (!gotTheLock) app.quit()
else void app.whenReady().then(async () => {
  startupMark('electronReadyMs')
  await import('./main')
}).catch(error => { console.error('[Startup]', error); app.exit(1) })
