import { type BrowserWindowConstructorOptions } from 'electron'

export const customTitleBar = process.platform === 'win32'

export const mainWindowChrome: Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay' | 'backgroundColor'> = {
  backgroundColor: '#0b1120',
  ...(customTitleBar ? {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#102134', symbolColor: '#cbd5e1', height: 32 },
  } : {}),
}
