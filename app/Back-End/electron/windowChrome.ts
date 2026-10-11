import type { BrowserWindowConstructorOptions } from 'electron'

export const customTitleBar = process.platform === 'win32'

/** Retain Windows caption controls, resizing and snap behavior with an app-colored header. */
export const mainWindowChrome: Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay' | 'backgroundColor'> = {
  backgroundColor: '#0b1120',
  ...(customTitleBar ? {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#102134', symbolColor: '#cbd5e1', height: 32 },
  } : {}),
}
