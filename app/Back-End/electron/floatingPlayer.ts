// Manages the frameless always-on-top picture-in-picture child window for the media player.
import { type BrowserWindow, screen, shell } from 'electron'

export function installFloatingPlayerWindow(owner: BrowserWindow): void {
  let floating: BrowserWindow | null = null
  owner.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName === 'cortex-floating-player' && !floating) {
      const area = screen.getDisplayMatching(owner.getBounds()).workArea
      const width = Math.min(560, area.width),
        height = Math.min(399, area.height)
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width,
          height,
          minWidth: 360,
          minHeight: 240,
          x: area.x + Math.max(0, area.width - width - 20),
          y: area.y + Math.max(0, area.height - height - 20),
          title: 'Cortex DL',
          frame: false,
          alwaysOnTop: true,
          autoHideMenuBar: true,
          backgroundColor: '#000000',
          fullscreenable: false,
          maximizable: false,
        },
      }
    }
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString())
      }
    } catch {
      // Ignore invalid URLs.
    }
    return { action: 'deny' }
  })
  owner.webContents.on('did-create-window', (child, details) => {
    if (details.frameName !== 'cortex-floating-player') return
    floating = child
    child.setMenu(null)
    const throttled = owner.webContents.getBackgroundThrottling()
    // Keep the owner unthrottled while PiP is open so playback timers don't stall when main is hidden.
    owner.webContents.setBackgroundThrottling(false)
    // Lock down the child window so links or redirects can't hijack the about:blank frame.
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    child.webContents.on('will-navigate', event => event.preventDefault())
    child.webContents.on('will-redirect', event => event.preventDefault())
    child.once('closed', () => {
      floating = null
      if (!owner.webContents.isDestroyed()) owner.webContents.setBackgroundThrottling(throttled)
    })
  })
}
