# Covers that differ between applications

For MP3, FLAC, M4A and MP4, **Change cover** replaces the embedded cover in the actual media file. Existing attached pictures are excluded from the remux, leaving one selected cover. Removing the cover leaves no attached pictures. Audio and video are copied without re-encoding; song tags, subtitles and chapters are preserved.

After verification, file replacement, library persistence and temporary-file cleanup, Cortex DL sends Windows a per-file `SHCNE_UPDATEITEM` notification using a Unicode path. This also runs for embedded cover removal. Failed or rolled-back edits do not notify. If notification fails or PowerShell is unavailable, the saved cover remains valid. Library-only covers in other formats cannot be displayed by external players.

Windows and each external player can cache artwork independently. An already-open player may continue showing its loaded image. Confirm that all applications are opening the same file path, then close the external player completely and reopen the file.

## Automatic Windows Media Player refresh

**Settings → Refresh Media Player and VLC cover caches** is enabled by default. The existing preference is preserved. After a successful embedded cover save or removal, Cortex DL matches Media Player images using the changed file's SHA-256 path identity. The current Windows 11 cache format was verified against the affected song on this installation. Only matching image variants are moved to `LocalCache\CortexArtworkBackups`, retaining one latest backup per variant. Other songs, music files, player preferences and the library database are left in place. Library-only cover edits do not refresh external players.

If matching images exist and Media Player is open, Cortex DL requests a graceful close of the verified Microsoft application. Playback stops; reopen the player to view the new cover and continue listening. No application is forcibly killed. If closing fails, paths are redirected, the cache format changes, or access is denied, refresh is skipped. The successfully saved cover is retained. Disable the setting to keep external playback uninterrupted; Windows shell notifications remain enabled.

This is an optional compatibility feature for Media Player's private cache, rather than a public Microsoft cache-management API. Future versions may use a different format; an unknown format is skipped without clearing the entire cache.

## Automatic VLC refresh on Windows

The same setting refreshes VLC 3 artwork after committed cover changes and removal. Cortex reuses title, artist, album and attachment count from the pre-edit verification probe; it does not launch another probe to clear the cache. VLC's attachment URL/title MD5 cache identity was matched to the affected song on this machine with VLC 3.0.24. Artist/album names follow VLC's filename sanitization. Only recognized `art` image files in matching `art/arturl` or `art/artistalbum` directories, and legacy `by-iiuid` references pointing to those images, are moved to `%APPDATA%\vlc\CortexArtworkBackups`. One latest backup per entry is kept. Unmatched files, VLC preferences and playlists are untouched; redirected paths and unknown formats are skipped.

VLC shares its artist/album cache across tracks in the same album, so refreshing that entry can cause other tracks in the album to rebuild their cover. VLC is never automatically closed. If it already loaded the old picture into memory, close VLC completely and reopen the song to see the change. Disk cache refresh cannot replace an image already in a running player's memory. Each player's refresh runs independently, and a cache failure never rolls back a saved cover.

If an old image persists:

1. **VLC:** close VLC. Press **Win+R**, enter `%APPDATA%\vlc`, and rename its `art` directory to an unused name such as `art-backup`. Reopen the media file. This keeps the old artwork cache as a backup; VLC can rebuild it from the file. Do not rename the whole `vlc` folder. Older VLC versions may also have cached artwork references under `by-iiuid`.
2. **Windows Media Player (the modern app):** close Media Player completely. If `%LOCALAPPDATA%\Packages\Microsoft.ZuneMusic_8wekyb3d8bbwe\LocalCache\Image` exists, rename only `Image` to an unused backup name and reopen the file. This cache location was confirmed on the affected Windows 11 installation; other versions may use a different location. Leave `LocalState` and its library database alone. If refreshing the image cache does not help, open **Settings → Apps → Installed apps → Media Player → Advanced options** and try **Repair**. As a last resort, **Reset** clears the app's data and preferences, so saved library configuration may need to be set up again.
3. **File Explorer:** reopen the folder and press **F5**. If thumbnails remain stale across multiple files, Windows thumbnail-cache cleanup may be needed; it is separate from VLC's artwork cache.

Cortex DL does not reset another player's library/settings or restart Explorer. A shell notification cannot force a third-party player to discard its private cache.

References: [Microsoft shell change notifications](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shchangenotify), [VLC 3 artwork cache implementation](https://github.com/videolan/vlc/blob/3.0.x/src/playlist/art.c), [Microsoft app repair and reset](https://support.microsoft.com/en-us/windows/apps/repair-apps-and-programs-in-windows).
