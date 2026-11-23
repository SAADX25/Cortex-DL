// Main-process app auto-updater service wrapping electron-updater with typed state, cancellation, and safe IPC broadcasts.
import { EventEmitter } from 'node:events'
import {
  APP_UPDATE_CHANNEL,
  type AppUpdateState,
  classifyUpdateError,
  createProgressSnapshot,
  extractUpdateSize,
  initialAppUpdateState,
  isCancellationError,
  parseReleaseNotes,
} from '../../../Shared/appUpdate'

export interface UpdaterCancellationToken {
  cancelled: boolean
  cancel: () => void
}

export interface UpdaterProgressPayload {
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}

export interface UpdaterInfoPayload {
  version: string
  files?: Array<{ size?: number; url?: string }>
  releaseName?: string | null
  releaseNotes?: unknown
  releaseDate?: string | null
}

export interface ElectronUpdaterLike extends EventEmitter {
  logger: unknown
  autoDownload: boolean
  allowDowngrade: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: (cancellationToken?: UpdaterCancellationToken) => Promise<string[]>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
}

export interface UpdateLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface AppUpdateController {
  getState: () => AppUpdateState
  checkForUpdates: (manual?: boolean) => Promise<AppUpdateState>
  downloadUpdate: () => Promise<AppUpdateState>
  cancelDownload: () => Promise<AppUpdateState>
  quitAndInstall: () => boolean
  dispose: () => void
}

interface LoadedUpdater {
  autoUpdater: ElectronUpdaterLike
  createCancellationToken: () => UpdaterCancellationToken
}

interface ControllerDeps {
  currentVersion: string
  isPackaged: () => boolean
  loadUpdater: () => Promise<LoadedUpdater>
  emitState: (state: AppUpdateState) => void
  onBeforeQuitForInstall: () => void
  logger: UpdateLogger
  now?: () => number
  progressThrottleMs?: number
}

export function createAppUpdateController(deps: ControllerDeps): AppUpdateController {
  const now = deps.now ?? (() => Date.now())
  const progressThrottleMs = deps.progressThrottleMs ?? 120

  let state: AppUpdateState = initialAppUpdateState(deps.currentVersion)
  let loaded: LoadedUpdater | null = null
  let loadPromise: Promise<LoadedUpdater> | null = null
  const currentPhase = () => state.phase
  let activeToken: UpdaterCancellationToken | null = null
  let hasUpdateCandidate = false
  let cancelling = false
  let disposed = false
  let lastProgressEmitMs = 0

  const publish = (next: AppUpdateState): AppUpdateState => {
    state = next
    if (!disposed) {
      deps.emitState(state)
    }
    return state
  }

  const updateState = (patch: Partial<AppUpdateState>): AppUpdateState =>
    publish({ ...state, ...patch })

  const attachListeners = (updater: ElectronUpdaterLike): void => {
    updater.logger = deps.logger
    updater.autoDownload = false
    updater.allowDowngrade = false
    updater.autoInstallOnAppQuit = true

    updater.on('checking-for-update', () => {
      if (disposed) return
      deps.logger.info('[Updater] Checking for updates...')
      updateState({
        phase: 'checking',
        errorCode: null,
        errorDetail: null,
        canCancel: false,
      })
    })

    updater.on('update-available', (info: UpdaterInfoPayload) => {
      if (disposed) return
      hasUpdateCandidate = true
      const totalSizeBytes = extractUpdateSize(info?.files)
      deps.logger.info(`[Updater] Update available: v${info?.version ?? 'unknown'}`)
      updateState({
        phase: 'available',
        latestVersion: info?.version || null,
        releaseName: typeof info?.releaseName === 'string' && info.releaseName.trim() ? info.releaseName.trim() : null,
        releaseDate: typeof info?.releaseDate === 'string' && info.releaseDate.trim() ? info.releaseDate.trim() : null,
        releaseNotes: parseReleaseNotes(info?.releaseNotes),
        totalSizeBytes,
        progress: null,
        errorCode: null,
        errorDetail: null,
        checkedAtMs: now(),
        canCancel: false,
      })
    })

    updater.on('update-not-available', () => {
      if (disposed) return
      hasUpdateCandidate = false
      deps.logger.info('[Updater] Application is up to date')
      updateState({
        phase: 'up-to-date',
        latestVersion: null,
        releaseName: null,
        releaseDate: null,
        releaseNotes: [],
        totalSizeBytes: null,
        progress: null,
        errorCode: null,
        errorDetail: null,
        checkedAtMs: now(),
        canCancel: false,
      })
    })

    updater.on('download-progress', (progressObj: UpdaterProgressPayload) => {
      if (disposed || cancelling) return
      const snapshot = createProgressSnapshot(progressObj, state.totalSizeBytes)
      const currentMs = now()
      const shouldEmit =
        state.phase !== 'downloading' ||
        snapshot.percent <= 0 ||
        snapshot.percent >= 100 ||
        currentMs - lastProgressEmitMs >= progressThrottleMs

      state = {
        ...state,
        phase: 'downloading',
        totalSizeBytes: snapshot.totalBytes > 0 ? snapshot.totalBytes : state.totalSizeBytes,
        progress: snapshot,
        errorCode: null,
        errorDetail: null,
        canCancel: activeToken != null,
      }

      if (shouldEmit) {
        lastProgressEmitMs = currentMs
        deps.emitState(state)
      }
    })

    updater.on('update-downloaded', (info: UpdaterInfoPayload) => {
      if (disposed) return
      activeToken = null
      cancelling = false
      const totalBytes = extractUpdateSize(info?.files) ?? state.totalSizeBytes ?? state.progress?.totalBytes ?? 0
      deps.logger.info(`[Updater] Update v${info?.version ?? state.latestVersion ?? 'unknown'} downloaded and ready`)
      updateState({
        phase: 'downloaded',
        latestVersion: info?.version || state.latestVersion,
        releaseName: typeof info?.releaseName === 'string' && info.releaseName.trim() ? info.releaseName.trim() : state.releaseName,
        releaseDate: typeof info?.releaseDate === 'string' && info.releaseDate.trim() ? info.releaseDate.trim() : state.releaseDate,
        releaseNotes: info?.releaseNotes ? parseReleaseNotes(info.releaseNotes) : state.releaseNotes,
        totalSizeBytes: totalBytes > 0 ? totalBytes : state.totalSizeBytes,
        progress: {
          percent: 100,
          transferredBytes: totalBytes,
          totalBytes,
          bytesPerSecond: 0,
          etaSeconds: null,
        },
        errorCode: null,
        errorDetail: null,
        canCancel: false,
      })
    })

    updater.on('update-cancelled', () => {
      if (disposed) return
      activeToken = null
      cancelling = false
      deps.logger.info('[Updater] Update download cancelled')
      updateState({
        phase: hasUpdateCandidate && state.latestVersion ? 'available' : 'idle',
        progress: null,
        errorCode: null,
        errorDetail: null,
        canCancel: false,
      })
    })

    updater.on('error', (err: Error) => {
      if (disposed) return
      if (cancelling || isCancellationError(err)) {
        cancelling = false
        activeToken = null
        return
      }
      activeToken = null
      const classified = classifyUpdateError(err)
      deps.logger.error('[Updater]', err)
      updateState({
        phase: 'error',
        errorCode: classified.code,
        errorDetail: classified.detail || null,
        canCancel: false,
      })
    })
  }

  const ensureLoaded = async () => {
    if (loaded) return loaded
    if (!loadPromise) {
      loadPromise = deps.loadUpdater().then((result) => {
        attachListeners(result.autoUpdater)
        loaded = result
        return result
      }).catch((err) => {
        loadPromise = null
        throw err
      })
    }
    return await loadPromise
  }

  const checkForUpdates = async (manual = false): Promise<AppUpdateState> => {
    if (disposed) return state
    if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'downloaded') {
      if (manual && !state.manualCheck) {
        updateState({ manualCheck: true })
      }
      return state
    }

    if (!deps.isPackaged()) {
      if (!manual) return state
      return updateState({
        phase: 'error',
        errorCode: 'unsupported',
        errorDetail: null,
        checkedAtMs: now(),
        manualCheck: true,
        canCancel: false,
      })
    }

    updateState({
      phase: 'checking',
      errorCode: null,
      errorDetail: null,
      manualCheck: manual,
      canCancel: false,
    })

    try {
      const runtime = await ensureLoaded()
      if (!runtime || disposed) return state
      await runtime.autoUpdater.checkForUpdates()
      // If updater was inactive and emitted no follow-up event, settle out of checking cleanly.
      if (currentPhase() === 'checking') {
        updateState({ phase: 'idle', checkedAtMs: now() })
      }
      return state
    } catch (err) {
      if (disposed) return state
      if (cancelling || isCancellationError(err)) {
        cancelling = false
        return state
      }
      const classified = classifyUpdateError(err)
      deps.logger.error('[Updater] Check failed:', err)
      return updateState({
        phase: 'error',
        errorCode: classified.code,
        errorDetail: classified.detail || null,
        checkedAtMs: now(),
        canCancel: false,
      })
    }
  }

  const downloadUpdate = async (): Promise<AppUpdateState> => {
    if (disposed) return state
    if (state.phase === 'downloading' || state.phase === 'downloaded') {
      return state
    }

    if (!deps.isPackaged()) {
      return updateState({
        phase: 'error',
        errorCode: 'unsupported',
        errorDetail: null,
        canCancel: false,
      })
    }

    try {
      const runtime = await ensureLoaded()
      if (!runtime || disposed) return state

      if (!hasUpdateCandidate) {
        const checked = await checkForUpdates(true)
        if (checked.phase !== 'available') return checked
      }

      cancelling = false
      lastProgressEmitMs = 0
      const token = runtime.createCancellationToken()
      activeToken = token

      updateState({
        phase: 'downloading',
        progress: createProgressSnapshot(
          { percent: 0, transferred: 0, total: state.totalSizeBytes ?? 0, bytesPerSecond: 0 },
          state.totalSizeBytes,
        ),
        errorCode: null,
        errorDetail: null,
        canCancel: true,
      })

      await runtime.autoUpdater.downloadUpdate(token)
      return state
    } catch (err) {
      if (disposed) return state
      activeToken = null
      if (cancelling || isCancellationError(err)) {
        cancelling = false
        return updateState({
          phase: hasUpdateCandidate && state.latestVersion ? 'available' : 'idle',
          progress: null,
          errorCode: null,
          errorDetail: null,
          canCancel: false,
        })
      }
      const classified = classifyUpdateError(err)
      deps.logger.error('[Updater] Download failed:', err)
      return updateState({
        phase: 'error',
        errorCode: classified.code === 'unknown' ? 'download' : classified.code,
        errorDetail: classified.detail || null,
        canCancel: false,
      })
    }
  }

  const cancelDownload = async (): Promise<AppUpdateState> => {
    if (disposed) return state
    if (state.phase !== 'downloading' || !activeToken) {
      return state
    }
    cancelling = true
    const token = activeToken
    activeToken = null
    try {
      token.cancel()
    } catch (err) {
      deps.logger.warn('[Updater] Cancel token threw:', err)
    }
    return updateState({
      phase: hasUpdateCandidate && state.latestVersion ? 'available' : 'idle',
      progress: null,
      errorCode: null,
      errorDetail: null,
      canCancel: false,
    })
  }

  const quitAndInstall = (): boolean => {
    if (disposed || !loaded || state.phase !== 'downloaded') {
      return false
    }
    deps.logger.info(`[Updater] Installing downloaded update v${state.latestVersion ?? 'unknown'}...`)
    deps.onBeforeQuitForInstall()
    loaded.autoUpdater.quitAndInstall(false, true)
    return true
  }

  const dispose = (): void => {
    disposed = true
    if (activeToken) {
      try { activeToken.cancel() } catch { /* ignore */ }
      activeToken = null
    }
    loaded?.autoUpdater.removeAllListeners()
  }

  return {
    getState: () => state,
    checkForUpdates,
    downloadUpdate,
    cancelDownload,
    quitAndInstall,
    dispose,
  }
}

export function createElectronUpdateService(options: {
  currentVersion: string
  isPackaged: () => boolean
  getWindow: () => { isDestroyed: () => boolean; webContents: { send: (channel: string, payload: unknown) => void } } | null
  onBeforeQuitForInstall: () => void
  logger: UpdateLogger
}): AppUpdateController {
  return createAppUpdateController({
    currentVersion: options.currentVersion,
    isPackaged: options.isPackaged,
    loadUpdater: async () => {
      const mod = await import('electron-updater')
      return {
        autoUpdater: mod.autoUpdater as unknown as ElectronUpdaterLike,
        createCancellationToken: () => new mod.CancellationToken(),
      }
    },
    emitState: (state) => {
      const win = options.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(APP_UPDATE_CHANNEL, state)
      }
    },
    onBeforeQuitForInstall: options.onBeforeQuitForInstall,
    logger: options.logger,
  })
}
