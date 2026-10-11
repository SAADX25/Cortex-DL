import { refreshWindowsPlayerArtwork } from './windowsPlayerArtwork'
import { refreshVlcArtwork, type VlcArtworkMetadata } from './vlcArtwork'

/** Each player's independent cache failure must leave the other refresh available. */
export async function refreshExternalPlayerArtwork(file: string, metadata: VlcArtworkMetadata): Promise<void> {
  await Promise.allSettled([refreshWindowsPlayerArtwork(file), refreshVlcArtwork(file, metadata)])
}
