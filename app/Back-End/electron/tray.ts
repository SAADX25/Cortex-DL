import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'

let tray: Tray | null = null

export function getTray(): Tray | null {
  return tray
}

export function createTray(
  iconPath: string, 
  getWin: () => BrowserWindow | null, 
  onQuit: () => void
): Tray {
  if (tray) return tray

  const trayIcon = nativeImage.createFromPath(iconPath)
  tray = new Tray(trayIcon)
  tray.setToolTip('Cortex DL')

  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Open Cortex DL', 
      click: () => getWin()?.show() 
    }, 
    { type: 'separator' }, 
    { 
      label: 'Quit / Exit', 
      click: () => { 
        onQuit()
        app.quit() 
      } 
    } 
  ])

  tray.setContextMenu(contextMenu)

  // Restore window on single click 
  tray.on('click', () => { 
    getWin()?.show()
  })

  return tray
}
