// Electron main process entrypoint: window lifecycle, startup/shutdown flow, and service wiring.
import {
  markStartup,
  previousStartupFailed,
  safeMode,
  gotTheLock,
  afterUiReady,
  startupTimings,
  startupMark,
  startupDuration,
  checkCachedEngines,
  reportEngineFailure,
  stopSetup,
  runSetup,
  setupState,
} from './bootstrap'
import log from 'electron-log'
import * as dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, session, ipcMain } from 'electron'
import { DownloadManager } from './downloadManager'
import { installIpcBoundary } from './ipcSecurity'
import { openLogs, exportDiagnostics, buildInfo } from './diagnostics'
import { registerLocalSubtitleIpc, stopLocalSubtitles } from './subtitles/ipc'
import { stopDownloadSubtitleMerges } from './subtitles/downloadMergeIpc'
import { registerIpcHandlers } from './ipc/handlers'
import { stopLibraryThumbnails } from './ipc/mediaLibraryIpc'
import { createTray, destroyTray } from './tray'
import { db } from './db'
import {
  verificationMetrics,
  engineReceipts,
  onEngineFailure,
  engineHealth,
} from './engines/engineManager'
import { createElectronUpdateService, type AppUpdateController } from './services/updateService'
import { installFloatingPlayerWindow } from './floatingPlayer'
import { mainWindowChrome } from './windowChrome'
import { installMediaSessionHeaders } from './mediaCors'
import { createMediaStreamingServer } from './mediaServer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.join(__dirname, '..', '.env') })

log.initialize({ preload: true })
log.transports.file.level = 'info'

export let downloads: DownloadManager | null = null

let updateService: AppUpdateController | null = null
let serviceReadyResolve!: () => void
const serviceReadyPromise = new Promise<void>(resolve => {
  serviceReadyResolve = resolve
})

process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'Front-End', 'dist')

let win: BrowserWindow | null = null
let isQuitting = false
let shutdownPromise: Promise<void> | null = null
let shutdownFinished = false

let shownResolve!: () => void
const shownPromise = new Promise<void>(resolve => {
  shownResolve = resolve
})

let firstRenderResolve!: () => void
const firstRenderPromise = new Promise<void>(resolve => {
  firstRenderResolve = resolve
})

const mediaServer = createMediaStreamingServer({
  getDownloads: () => downloads,
  isQuitting: () => isQuitting,
  devServerUrl: VITE_DEV_SERVER_URL,
  onListening: port => {
    MEDIA_SERVER_PORT = port
    startupMark('mediaServerReadyMs')
  },
})

export let MEDIA_SERVER_PORT = mediaServer.getPort()
export const MEDIA_SERVER_TOKEN = mediaServer.token

function ensureUpdateService(): AppUpdateController {
  if (!updateService) {
    updateService = createElectronUpdateService({
      currentVersion: app.getVersion(),
      isPackaged: () => app.isPackaged,
      getWindow: () => win,
      onBeforeQuitForInstall: () => {
        isQuitting = true
      },
      logger: log,
    })
  }
  return updateService
}

async function loadBackendServices(): Promise<void> {
  if (isQuitting) return

  startupMark('updaterStartMs')
  const updaterStarted = performance.now()
  const updater = ensureUpdateService()
  startupDuration('updaterInitializationMs', updaterStarted)

  log.info('Backend services loaded. Running startup checks...')

  if (app.isPackaged) {
    void updater.checkForUpdates(false)
  }
}

function initTray(): void {
  const iconPath = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT!, 'Front-End', 'public', 'CortexDL.ico')
    : path.join(RENDERER_DIST, 'CortexDL.ico')

  createTray(
    iconPath,
    () => win,
    () => {
      isQuitting = true
    },
  )
}

function createWindow(): void {
  const iconPath = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT!, 'public', 'CortexDL.ico')
    : path.join(RENDERER_DIST, 'CortexDL.ico')

  win = new BrowserWindow({
    ...mainWindowChrome,
    width: 1100,
    height: 720,
    minWidth: 850,
    minHeight: 580,
    title: 'Cortex DL',
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (!downloads) {
    const managerStarted = performance.now()
    downloads = new DownloadManager()
    startupDuration('downloadManagerConstructionMs', managerStarted)
    serviceReadyResolve()
  }
  downloads.attachWindow(win)

  try {
    win.setMenu(null)
  } catch (err) {
    log.warn('Failed to remove menu:', err)
  }

  win.once('ready-to-show', () => {
    startupMark('readyToShowMs')
    win?.show()
    startupMark('windowShownMs')
    shownResolve()
    initTray()
  })

  // Hide to system tray on close unless an explicit app quit is underway.
  win.on('close', event => {
    if (!isQuitting) {
      event.preventDefault()
      win?.webContents.send('cortexdl:close-media-player')
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault()
  })
  let crashes = 0
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('[Renderer crash]', {
      ...buildInfo(),
      ...details,
      timestamp: new Date().toISOString(),
    })
    if (++crashes > 1) void offerSafeMode()
  })
  installFloatingPlayerWindow(win)

  startupMark('rendererLoadStartMs')
  win.webContents.once('did-finish-load', () => startupMark('rendererLoadMs'))
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  installMediaSessionHeaders(session.defaultSession)
}

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })

  // Defer quit once so background workers, child processes, and SQLite state can flush cleanly.
  app.on('before-quit', event => {
    isQuitting = true
    if (shutdownFinished) return
    event.preventDefault()
    if (shutdownPromise) return
    shutdownPromise = (async () => {
      await stopLocalSubtitles()
      await stopDownloadSubtitleMerges()
      await stopLibraryThumbnails()
      updateService?.dispose()
      await engineReceipts.stop()
      await stopSetup()
      await mediaServer.stop()
      destroyTray()

      try {
        if (downloads && downloads.getActiveCount() > 0) {
          log.info(
            `[Shutdown] Pausing ${downloads.getActiveCount()} active downloads before quit...`,
          )
          await downloads.pauseAll()
        }
      } finally {
        downloads?.flushPendingSave()
      }
    })()
      .catch(err => {
        log.error('[Shutdown] Cleanup failed:', err)
      })
      .finally(() => {
        markStartup('clean-shutdown')
        shutdownFinished = true
        app.quit()
      })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
      win = null
    }
  })

  app.on('activate', () => {
    if (isQuitting) return
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  installIpcBoundary(() => win)
  ipcMain.on('cortexdl:first-ui-render', () => {
    if (startupTimings.firstUiRenderMs !== undefined) return
    startupMark('firstUiRenderMs')
    firstRenderResolve()
  })
  onEngineFailure(message => {
    if (win && !isQuitting) reportEngineFailure(win, message)
  })
  registerIpcHandlers({
    getWin: () => win,
    getDownloads: () => downloads,
    getUpdateService: () => ensureUpdateService(),
    getMediaPort: () => mediaServer.getPort(),
    getMediaToken: () => mediaServer.token,
    closeMediaSession: s => mediaServer.requests.closeSession(s),
    getMediaRequestStats: () => mediaServer.requests.snapshot(),
    trackMediaProcess: (s, kind, stop) =>
      mediaServer.requests.track(s, kind === 'probe' ? 'probe' : 'subtitle', stop),
    isMediaSessionClosed: s => mediaServer.requests.isClosed(s),
    serviceReadyPromise,
    mediaReadyPromise: mediaServer.readyPromise,
    uiReadyPromise: Promise.all([shownPromise, firstRenderPromise]),
  })

  app
    .whenReady()
    .then(async () => {
      createWindow()
      registerLocalSubtitleIpc(() => win)

      markStartup('starting')
      if (previousStartupFailed && !safeMode) void offerSafeMode()

      ipcMain.handle('cortexdl:setup-state', () => setupState)
      ipcMain.handle('cortexdl:repair-engines', async () => {
        if (downloads?.getActiveCount()) {
          return { ...setupState, message: 'Wait for active downloads to finish before repair.' }
        }
        await initializeRuntime(true, true)
        return setupState
      })
      ipcMain.handle('cortexdl:open-logs', () => openLogs())
      ipcMain.handle('cortexdl:exit', () => app.quit())
      ipcMain.handle('cortexdl:export-diagnostics', async () =>
        win
          ? exportDiagnostics(win, {
              engines: await engineHealth(),
              database: db.pragma('quick_check', { simple: true }),
              mediaServer: mediaServer.isRunning(),
              runtimeState: setupState.status,
            })
          : false,
      )
      ipcMain.handle('cortexdl:build-info', () => ({ ...buildInfo(), safeMode }))
      const cachedCheck = checkCachedEngines(win!).catch(error =>
        log.error('[Engine cache]', error),
      )

      // Wait for first paint before kicking off updater, media server, and background engine checks.
      const uiReady = Promise.all([shownPromise, firstRenderPromise])
      void afterUiReady(uiReady, loadBackendServices, error =>
        log.error('[Updater initialization]', error),
      )
      await uiReady
      if (isQuitting) return
      await cachedCheck
      markStartup('ready')
      mediaServer.start()
      void afterUiReady(
        uiReady,
        async () => {
          const started = performance.now()
          await downloads?.cleanupSettledFragments()
          startupDuration('fragmentCleanupMs', started)
        },
        error => log.error('[Fragment cleanup]', error),
      )
      await afterUiReady(
        uiReady,
        () => initializeRuntime(),
        error => log.error('[Background setup]', error),
      )
      log.info('[Startup timings]', startupTimings, verificationMetrics)
    })
    .catch(error => {
      log.error('[Startup fatal]', error)
      app.exit(1)
    })
}

let initialization: Promise<void> | null = null

async function initializeRuntime(allowNetwork = true, force = false): Promise<void> {
  if (isQuitting) return
  if (initialization) return initialization
  initialization = (async () => {
    try {
      if (!win) throw new Error('Window unavailable')
      startupMark('backgroundEngineStartMs')
      await runSetup(win, allowNetwork, force)
      markStartup('ready')
    } catch (error) {
      log.error('[Runtime unavailable]', error)
    }
  })().finally(() => {
    initialization = null
  })
  return initialization
}

async function offerSafeMode(): Promise<void> {
  if (!win) return
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Crash recovery',
    message:
      'The previous startup did not finish or a renderer/GPU failed repeatedly. You can restart in Safe Mode or open diagnostics.',
    buttons: ['Continue', 'Restart in Safe Mode', 'Open Logs'],
    defaultId: 0,
    cancelId: 0,
  })
  if (result.response === 1) {
    app.relaunch({
      args: [...process.argv.slice(1).filter(arg => arg !== '--safe-mode'), '--safe-mode'],
    })
    app.quit()
  }
  if (result.response === 2) await openLogs()
}

let gpuCrashes = 0

app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU' && ++gpuCrashes >= 2 && !safeMode) void offerSafeMode()
})
