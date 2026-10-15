import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import { MediaLibrary } from '../mediaLibrary'
import { LIBRARY_EXTENSIONS, canEmbedLibraryArtwork, canEditLibraryArtwork } from '../../../Shared/mediaLibrary'
import { LibraryThumbnails } from '../services/thumbnailService'
import { AudioArtwork } from '../services/artworkService'
import { engineReceipts } from '../engines/engineManager'
import { getBinaryPath } from '../paths'

const thumbnailCaches = new Set<LibraryThumbnails>()

const artworkEditors = new Set<AudioArtwork>()

let instance: MediaLibrary | undefined

const library = () => instance ??= new MediaLibrary(path.join(app.getPath('userData'), 'media-library.json'))

export function isLibraryMediaPath(requestedPath: string, resolvedPath: string): Promise<boolean> {
  return library().canServe(requestedPath, resolvedPath).catch(() => false)
}

export async function stopLibraryThumbnails(): Promise<void> {
  await Promise.all([...thumbnailCaches, ...artworkEditors].map(cache => cache.stop()))
  thumbnailCaches.clear()
  artworkEditors.clear()
}

export function registerMediaLibraryIpc(getWin: () => BrowserWindow | null): void {
  let thumbnails: LibraryThumbnails | undefined
  let artwork: AudioArtwork | undefined
  const editor = () => {
    if (!artwork) {
      artwork = new AudioArtwork(async name => {
        if (!(await engineReceipts.ensure(name)).available) throw new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED')
        return getBinaryPath(name)
      })
      artworkEditors.add(artwork)
    }
    return artwork
  }
  const saveArtwork = async (id: string, image: Buffer | null, refreshPlayer = false) => library().setArtwork(id, image, async (file, persist) => {
    if (canEmbedLibraryArtwork(file)) await editor().write(file, image, () => persist(true), refreshPlayer)
    else await persist()
  })
  const images = () => {
    if (!thumbnails) {
      thumbnails = new LibraryThumbnails(path.join(app.getPath('userData'), 'library-thumbnails'), async () => {
        if (!(await engineReceipts.ensure('ffmpeg')).available) throw new Error('Thumbnail engine unavailable')
        return getBinaryPath('ffmpeg')
      }, file => editor().coverStream(file))
      thumbnailCaches.add(thumbnails)
    }
    return thumbnails
  }
  const artworkInfo = async (id: string) => {
    const item = await library().get(id, false)
    if (!item) return { thumbnail: null, embedded: false }
    const custom = await library().getArtwork(id)

    if (custom) return { thumbnail: `data:image/jpeg;base64,${custom.toString('base64')}`, embedded: item.artworkEmbedded === true }
    return images().getInfo(item)
  }
  ipcMain.handle('cortexdl:library:artwork-info', (_event, id: string) => artworkInfo(id))
  ipcMain.handle('cortexdl:library:thumbnail', async (_event, id: string) => (await artworkInfo(id)).thumbnail)
  ipcMain.handle('cortexdl:library:artwork-select', async (_event, id: string, refreshPlayer = false) => {
    const item = await library().get(id)
    if (!item) throw new Error('MEDIA_LIBRARY_NOT_FOUND')
    if (!canEditLibraryArtwork(item)) throw new Error('MEDIA_LIBRARY_ARTWORK_UNSUPPORTED')
    const win = getWin()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose media cover · اختيار صورة الغلاف', properties: ['openFile'],
      filters: [{ name: 'Images · الصور (8 MB)', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    const image = await images().prepareArtwork(result.filePaths[0])
    return saveArtwork(id, image, refreshPlayer)
  })
  ipcMain.handle('cortexdl:library:artwork-embed', async (_event, id: string, refreshPlayer = false) => {
    const item = await library().get(id)
    if (!item || !canEmbedLibraryArtwork(item.filePath)) throw new Error('MEDIA_LIBRARY_ARTWORK_UNSUPPORTED')
    const image = await library().getArtwork(id)
    if (!image) throw new Error('MEDIA_LIBRARY_ARTWORK_INVALID')
    return saveArtwork(id, image, refreshPlayer)
  })
  ipcMain.handle('cortexdl:library:artwork-remove', async (_event, id: string, refreshPlayer = false) => {
    const item = await library().get(id)
    const embedded = item && canEmbedLibraryArtwork(item.filePath) && await editor().coverStream(item.filePath) !== null
    return item?.artwork || embedded ? saveArtwork(id, null, refreshPlayer) : library().setArtwork(id, null)
  })
  const select = async (multiple: boolean) => {
    const win = getWin()
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Video & audio', extensions: [...LIBRARY_EXTENSIONS] }],
    })
    return result.canceled ? [] : result.filePaths
  }
  ipcMain.handle('cortexdl:library:list', () => library().catalog())
  ipcMain.handle('cortexdl:library:check', (_event, ids: string[]) => library().check(ids))
  ipcMain.handle('cortexdl:library:select', async () => {
    const files = await select(true)
    return files.length ? library().add(files) : null
  })
  ipcMain.handle('cortexdl:library:add', (_event, files: string[]) => library().add(files))
  ipcMain.handle('cortexdl:library:remove', (_event, id: string) => library().remove(id))
  ipcMain.handle('cortexdl:library:play', (_event, id: string) => library().play(id))
  ipcMain.handle('cortexdl:library:relocate', async (_event, id: string) => {
    const files = await select(false)
    return files.length ? library().relocate(id, files[0]) : null
  })
}
