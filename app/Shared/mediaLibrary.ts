export const LIBRARY_VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'ogv', 'm4v'] as const
export const LIBRARY_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'wma'] as const
export const LIBRARY_EXTENSIONS = [...LIBRARY_VIDEO_EXTENSIONS, ...LIBRARY_AUDIO_EXTENSIONS]
export const canEmbedLibraryArtwork = (filePath: string): boolean => /\.(mp3|flac|m4a|mp4)$/i.test(filePath)
export const canEditLibraryArtwork = (item: Pick<LibraryMediaItem, 'kind' | 'filePath'>): boolean => item.kind === 'audio' || canEmbedLibraryArtwork(item.filePath)
export type LibraryArtworkInfo = { thumbnail: string | null; embedded: boolean }
export type LibraryMediaKind = 'video' | 'audio'
export type LibraryMediaItem = {
  id: string
  filePath: string
  name: string
  kind: LibraryMediaKind
  size: number
  addedAt: number
  lastPlayedAt: number | null
  availability: 'available' | 'missing' | 'unreadable'
  artwork?: string
  artworkEmbedded?: boolean
}
export type LibraryImportResult = {
  items: LibraryMediaItem[]
  added: number
  duplicates: number
  rejected: { filePath: string; reason: 'unsupported' | 'missing' | 'unreadable' }[]
}
export function libraryMediaKind(filePath: string): LibraryMediaKind | null {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
  if ((LIBRARY_VIDEO_EXTENSIONS as readonly string[]).includes(extension)) return 'video'
  if ((LIBRARY_AUDIO_EXTENSIONS as readonly string[]).includes(extension)) return 'audio'
  return null
}
