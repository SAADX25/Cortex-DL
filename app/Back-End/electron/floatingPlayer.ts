import { type BrowserWindow, screen, shell } from 'electron'

/** Only the player's empty, same-origin surface may become an app window. */
export function installFloatingPlayerWindow(owner: BrowserWindow): void {
  let floating: BrowserWindow | null = null
  owner.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName === 'cortex-floating-player' && !floating) {
      const area = screen.getDisplayMatching(owner.getBounds()).workArea
      const width = Math.min(560, area.width), height = Math.min(399, area.height)
      return { action: 'allow', overrideBrowserWindowOptions: {
        width, height, minWidth: 360, minHeight: 240,
        x: area.x + Math.max(0, area.width - width - 20), y: area.y + Math.max(0, area.height - height - 20),
        title: 'Cortex DL', frame: false, alwaysOnTop: true, autoHideMenuBar: true,
        backgroundColor: '#000000', fullscreenable: false, maximizable: false,
      } }
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  owner.webContents.on('did-create-window', (child, details) => {
    if (details.frameName !== 'cortex-floating-player') return
    floating = child
    child.setMenu(null)
    const throttled = owner.webContents.getBackgroundThrottling()
    owner.webContents.setBackgroundThrottling(false)
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    child.webContents.on('will-navigate', event => event.preventDefault())
    child.webContents.on('will-redirect', event => event.preventDefault())
    child.once('closed', () => {
      floating = null
      if (!owner.webContents.isDestroyed()) owner.webContents.setBackgroundThrottling(throttled)
    })
  })
}
