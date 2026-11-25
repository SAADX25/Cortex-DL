const { suite } = require('./register-ts.cjs')

suite('App update model and backend controller', test => {
  const assert = require('node:assert/strict')
  const { EventEmitter } = require('node:events')
  const {
    parseReleaseNotes,
    extractUpdateSize,
    computeUpdateEta,
    createProgressSnapshot,
    classifyUpdateError,
    isCancellationError,
  } = require('../Shared/appUpdate.ts')
  const { createAppUpdateController } = require('../Back-End/electron/services/updateService.ts')
  const { validateIpcArguments } = require('../Back-End/electron/ipcSecurity.ts')

  test('release notes parser strips HTML safely, decodes entities and skips filler text', () => {
    const html =
      '<p><strong>Highlights</strong></p><ul><li>Faster YouTube &amp; Threads analysis</li><li>Fixed RTL subtitle alignment</li><li>No content.</li><li>Full Changelog: https://github.com/SAADX25/Cortex-DL</li></ul><script>alert(1)</script>'
    const notes = parseReleaseNotes(html)
    assert.deepEqual(notes, [
      'Highlights',
      'Faster YouTube & Threads analysis',
      'Fixed RTL subtitle alignment',
    ])
    assert.deepEqual(parseReleaseNotes('No content.'), [])
    assert.deepEqual(
      parseReleaseNotes([{ version: '2.3.5', note: '- Added new updater UI\n- Fixed crash' }]),
      ['Added new updater UI', 'Fixed crash'],
    )
  })

  test('progress snapshot, ETA and error classification handle common update failure modes', () => {
    assert.equal(
      extractUpdateSize([{ url: 'Cortex-DL-Setup-2.3.5.exe', size: 124596622 }]),
      124596622,
    )
    assert.equal(computeUpdateEta(50_000_000, 100_000_000, 5_000_000), 10)
    assert.equal(computeUpdateEta(100, 100, 50), null)

    const snap = createProgressSnapshot(
      { percent: 42.6, transferred: 426, total: 1000, bytesPerSecond: 100 },
      null,
    )
    assert.equal(snap.percent, 42.6)
    assert.equal(snap.etaSeconds, 6)

    assert.equal(
      classifyUpdateError(
        new Error(
          'Cannot find latest.yml in the latest release artifacts (https://github.com/x): HttpError: 404',
        ),
      ).code,
      'not-published',
    )
    assert.equal(classifyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')).code, 'offline')
    assert.equal(classifyUpdateError(new Error('sha512 checksum mismatch')).code, 'integrity')
    assert.equal(classifyUpdateError(new Error('ENOENT: app-update.yml')).code, 'unsupported')
    assert.equal(isCancellationError(new Error('Download cancelled')), true)
  })

  test('update IPC channels reject unexpected arguments', () => {
    for (const channel of [
      'cortexdl:update:state',
      'cortexdl:update:download',
      'cortexdl:update:cancel',
      'cortexdl:check-for-updates',
      'cortexdl:restart-app',
    ]) {
      assert.doesNotThrow(() => validateIpcArguments(channel, []))
      assert.throws(() => validateIpcArguments(channel, ['unexpected']), /Invalid update operation/)
    }
  })

  test('controller transitions cleanly across check, download, cancel, retry, completion and install', async () => {
    class FakeUpdater extends EventEmitter {
      constructor() {
        super()
        this.logger = null
        this.autoDownload = true
        this.allowDowngrade = true
        this.autoInstallOnAppQuit = false
        this.quitCalls = []
        this.downloadMode = 'cancel'
      }
      async checkForUpdates() {
        this.emit('checking-for-update')
        this.emit('update-available', {
          version: '2.3.6',
          files: [{ url: 'Cortex-DL-Setup-2.3.6.exe', size: 120_000_000 }],
          releaseDate: '2026-11-23T08:00:00.000Z',
          releaseNotes:
            '<ul><li>New dark in-app update dialog</li><li>Improved stability</li></ul>',
        })
        return null
      }
      async downloadUpdate(token) {
        this.emit('download-progress', {
          percent: 35,
          transferred: 42_000_000,
          total: 120_000_000,
          bytesPerSecond: 6_000_000,
        })
        if (this.downloadMode === 'cancel') {
          return await new Promise((_resolve, reject) => {
            this._pendingReject = reject
            this._activeToken = token
          })
        }
        this.emit('download-progress', {
          percent: 100,
          transferred: 120_000_000,
          total: 120_000_000,
          bytesPerSecond: 6_000_000,
        })
        this.emit('update-downloaded', {
          version: '2.3.6',
          files: [{ url: 'Cortex-DL-Setup-2.3.6.exe', size: 120_000_000 }],
        })
        return ['Cortex-DL-Setup-2.3.6.exe']
      }
      quitAndInstall(isSilent, isForceRunAfter) {
        this.quitCalls.push({ isSilent, isForceRunAfter })
      }
    }

    const fake = new FakeUpdater()
    const events = []
    let beforeQuitCalled = false
    let tick = 1000

    const controller = createAppUpdateController({
      currentVersion: '2.3.5',
      isPackaged: () => true,
      loadUpdater: async () => ({
        autoUpdater: fake,
        createCancellationToken: () => {
          const token = {
            cancelled: false,
            cancel() {
              this.cancelled = true
              fake.emit('update-cancelled')
              fake.emit('error', new Error('cancelled'))
              fake._pendingReject?.(new Error('cancelled'))
            },
          }
          return token
        },
      }),
      emitState: state => events.push({ ...state }),
      onBeforeQuitForInstall: () => {
        beforeQuitCalled = true
      },
      logger: { info() {}, warn() {}, error() {} },
      now: () => (tick += 250),
    })

    const checked = await controller.checkForUpdates(true)
    assert.equal(checked.phase, 'available')
    assert.equal(checked.latestVersion, '2.3.6')
    assert.equal(checked.totalSizeBytes, 120_000_000)
    assert.deepEqual(checked.releaseNotes, ['New dark in-app update dialog', 'Improved stability'])
    assert.equal(fake.autoDownload, false)
    assert.equal(fake.allowDowngrade, false)

    const downloadPromise = controller.downloadUpdate()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(controller.getState().phase, 'downloading')
    assert.equal(controller.getState().canCancel, true)
    assert.equal(controller.getState().progress.percent, 35)

    const cancelled = await controller.cancelDownload()
    await downloadPromise
    assert.equal(cancelled.phase, 'available')
    assert.equal(controller.getState().phase, 'available')
    assert.equal(controller.getState().latestVersion, '2.3.6')
    assert.equal(controller.getState().errorCode, null)

    fake.downloadMode = 'complete'
    const finished = await controller.downloadUpdate()
    assert.equal(finished.phase, 'downloaded')
    assert.equal(finished.progress.percent, 100)

    const installed = controller.quitAndInstall()
    assert.equal(installed, true)
    assert.equal(beforeQuitCalled, true)
    assert.deepEqual(fake.quitCalls, [{ isSilent: false, isForceRunAfter: true }])
    assert.ok(events.length >= 5)
    controller.dispose()
  })

  test('controller reports unpackaged manual checks and missing latest.yml without throwing', async () => {
    const devController = createAppUpdateController({
      currentVersion: '2.3.5',
      isPackaged: () => false,
      loadUpdater: async () => {
        throw new Error('should not load updater in dev')
      },
      emitState() {},
      onBeforeQuitForInstall() {},
      logger: { info() {}, warn() {}, error() {} },
    })

    assert.equal((await devController.checkForUpdates(false)).phase, 'idle')
    const manual = await devController.checkForUpdates(true)
    assert.equal(manual.phase, 'error')
    assert.equal(manual.errorCode, 'unsupported')

    class FailingUpdater extends EventEmitter {
      async checkForUpdates() {
        const err = new Error(
          'Cannot find latest.yml in the latest release artifacts: HttpError: 404',
        )
        this.emit('error', err)
        throw err
      }
      async downloadUpdate() {
        return []
      }
      quitAndInstall() {}
    }

    const failingController = createAppUpdateController({
      currentVersion: '2.3.5',
      isPackaged: () => true,
      loadUpdater: async () => ({
        autoUpdater: new FailingUpdater(),
        createCancellationToken: () => ({ cancelled: false, cancel() {} }),
      }),
      emitState() {},
      onBeforeQuitForInstall() {},
      logger: { info() {}, warn() {}, error() {} },
    })

    const failed = await failingController.checkForUpdates(true)
    assert.equal(failed.phase, 'error')
    assert.equal(failed.errorCode, 'not-published')
  })
})

suite('UpdateModal and sidebar visual layout', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const { spawn } = require('node:child_process')

  test(
    'UpdateModal and sidebar pill render cleanly in English and Arabic across all phases',
    { skip: process.platform !== 'win32', timeout: 30000 },
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-update-ui-'))
      const root = path.resolve(__dirname, '..')
      try {
        const esbuild = require('esbuild')
        esbuild.buildSync({
          entryPoints: [path.join(root, 'Back-End/electron/windowChrome.ts')],
          bundle: true,
          platform: 'node',
          external: ['electron'],
          format: 'cjs',
          outfile: path.join(directory, 'chrome.cjs'),
        })
        esbuild.buildSync({
          stdin: {
            contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import Sidebar from './Front-End/src/components/Sidebar';
            import SettingsTab from './Front-End/src/components/SettingsTab';
            import UpdateModal from './Front-End/src/components/UpdateModal';
            import { useSettingsStore } from './Front-End/src/stores/useSettingsStore';
            import './Front-End/src/App.css';

            window.cortexDl = {
              customTitleBar: true,
              getUpdateState: async () => useSettingsStore.getState().updateState,
              checkForUpdates: async () => useSettingsStore.getState().updateState,
              downloadUpdate: async () => {
                const cur = useSettingsStore.getState().updateState;
                const next = { ...cur, phase: 'downloading', canCancel: true, progress: { percent: 64, transferredBytes: 79741838, totalBytes: 124596622, bytesPerSecond: 6420000, etaSeconds: 7 } };
                useSettingsStore.getState().applyUpdateState(next);
                return next;
              },
              cancelUpdateDownload: async () => {
                const cur = useSettingsStore.getState().updateState;
                const next = { ...cur, phase: 'available', canCancel: false, progress: null };
                useSettingsStore.getState().applyUpdateState(next);
                return next;
              },
              restartApp: async () => { window.__restarted = true; return true; },
              onUpdateStatus: () => () => {},
              repairEngines: async () => ({}),
              exportDiagnostics: async () => true,
              openLogs: async () => {},
              getHealthCheck: async () => ({ checkedAt: Date.now(), healthy: true, ytDlp: { available: true, version: '2026.10.26' }, ffmpeg: { available: true, path: 'ffmpeg', version: '9.0.2' }, jsRuntime: { available: true, name: 'Deno' }, downloadDirectory: { writable: true, path: 'C:/Downloads' } }),
              checkJsRuntime: async () => ({ available: true, name: 'Deno' }),
            };

            window.fixture = {
              setLang: (lang) => useSettingsStore.setState({ lang }),
              setUpdate: (state, open = true) => {
                useSettingsStore.getState().applyUpdateState(state);
                useSettingsStore.setState({ updateModalOpen: open });
              },
            };

            function Shell() {
              const lang = useSettingsStore((s) => s.lang);
              return (
                <div className="app-container has-titlebar" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                  <div className="app-titlebar" aria-hidden="true"><div className="app-titlebar-drag" /></div>
                  <Sidebar />
                  <main className="main-content"><SettingsTab /></main>
                  <UpdateModal />
                </div>
              );
            }

            createRoot(document.getElementById('root')).render(<Shell />);
          `,
            resolveDir: root,
            loader: 'jsx',
          },
          bundle: true,
          outfile: path.join(directory, 'renderer.js'),
          define: {
            'process.env.NODE_ENV': '"production"',
            __APP_VERSION__: '"2.2.5"',
            __BUILD_SHA__: '"5d7f72a9ce17"',
          },
        })
        await fs.writeFile(
          path.join(directory, 'index.html'),
          '<!doctype html><html><head><meta charset="utf-8"><title>Cortex DL</title><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
        )
        await fs.writeFile(
          path.join(directory, 'electron.cjs'),
          `
          const { app, BrowserWindow } = require('electron');
          const assert = require('node:assert/strict');
          const fs = require('node:fs');
          const path = require('node:path');
          app.disableHardwareAcceleration();
          app.setPath('userData', path.join(__dirname, 'profile'));
          const delay = (ms) => new Promise((r) => setTimeout(r, ms));
          app.whenReady().then(async () => {
            const { mainWindowChrome } = require('./chrome.cjs');
            const win = new BrowserWindow({
              ...mainWindowChrome,
              show: false,
              width: 1100,
              height: 720,
              webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false },
            });
            const js = (s) => win.webContents.executeJavaScript(s, true);
            const wait = async (s) => {
              for (let n = 0; n < 80; n++) {
                if (await js(s)) return;
                await delay(25);
              }
              throw new Error('Timed out waiting for: ' + s);
            };
            const capture = async (name) => {
              if (!process.env.CORTEX_UPDATE_CAPTURE) return;
              await delay(220);
              fs.mkdirSync(process.env.CORTEX_UPDATE_CAPTURE, { recursive: true });
              fs.writeFileSync(path.join(process.env.CORTEX_UPDATE_CAPTURE, name + '.png'), (await win.webContents.capturePage()).toPNG());
            };
            await win.loadFile(path.join(__dirname, 'index.html'));
            await wait('!!document.querySelector(".sidebar")');

            const baseAvailable = {
              phase: 'available',
              currentVersion: '2.2.5',
              latestVersion: '2.3.5',
              releaseName: 'Cortex DL v2.3.5',
              releaseDate: '2026-11-23T06:45:28.468Z',
              releaseNotes: [
                'Redesigned dark glass update experience with live download speed and ETA',
                'Improved Arabic RTL subtitle layout and media library cover caching',
                'Faster YouTube & Threads link analysis with reduced memory usage',
              ],
              totalSizeBytes: 124596622,
              progress: null,
              errorCode: null,
              errorDetail: null,
              checkedAtMs: Date.now(),
              canCancel: false,
              manualCheck: true,
            };

            for (const lang of ['en', 'ar']) {
              await js('window.fixture.setLang(' + JSON.stringify(lang) + ')');
              await js('window.fixture.setUpdate(' + JSON.stringify(baseAvailable) + ', true)');
              await wait('!!document.querySelector(".update-modal-card.phase-available")');
              const bounds = await js('(() => { const card = document.querySelector(".update-modal-card").getBoundingClientRect(); const titlebar = document.querySelector(".app-titlebar").getBoundingClientRect(); return { top: card.top, bottom: card.bottom, left: card.left, right: card.right, titlebarBottom: titlebar.bottom, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }; })()');
              assert.ok(bounds.top >= bounds.titlebarBottom, 'Modal must stay below custom titlebar: ' + JSON.stringify(bounds));
              assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height, JSON.stringify(bounds));
              assert.equal(bounds.scrollWidth, bounds.width);
              await capture('update-available-' + lang);

              await js('document.querySelector(".update-btn-primary").click()');
              await wait('!!document.querySelector(".update-modal-card.phase-downloading")');
              assert.equal(await js('document.querySelector(".update-progress-percent").textContent'), '64%');
              assert.equal(await js('!!document.querySelector(".sidebar-update-pill.phase-downloading")'), true);
              await capture('update-downloading-' + lang);

              await js('document.querySelector(".update-btn-secondary").click()');
              await wait('!document.querySelector(".update-modal-card")');
              assert.equal(await js('!!document.querySelector(".sidebar-update-pill.phase-downloading")'), true);
              await capture('update-background-' + lang);
              await js('document.querySelector(".sidebar-update-pill").click()');
              await wait('!!document.querySelector(".update-modal-card.phase-downloading")');

              const downloadedState = {
                ...baseAvailable,
                phase: 'downloaded',
                progress: { percent: 100, transferredBytes: 124596622, totalBytes: 124596622, bytesPerSecond: 0, etaSeconds: null },
              };
              await js('window.fixture.setUpdate(' + JSON.stringify(downloadedState) + ', true)');
              await wait('!!document.querySelector(".update-modal-card.phase-downloaded")');
              await capture('update-downloaded-' + lang);
            }

            await js('document.querySelector(".update-btn-success").click()');
            await wait('window.__restarted === true');

            win.destroy();
            app.quit();
          }).catch((err) => { console.error(err); app.exit(1); });
        `,
        )
        const env = { ...process.env }
        delete env.ELECTRON_RUN_AS_NODE
        const result = await new Promise((resolve, reject) => {
          const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], {
            windowsHide: true,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          let output = ''
          child.stdout.on('data', chunk => {
            output += chunk
          })
          child.stderr.on('data', chunk => {
            output += chunk
          })
          const timer = setTimeout(() => {
            child.kill()
            reject(new Error('Update UI test timed out: ' + output))
          }, 25000)
          child.once('error', error => {
            clearTimeout(timer)
            reject(error)
          })
          child.once('close', code => {
            clearTimeout(timer)
            resolve({ code, output })
          })
        })
        assert.equal(result.code, 0, result.output)
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
  )
})
