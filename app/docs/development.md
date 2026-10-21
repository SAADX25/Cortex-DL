# Development guide

Use the [code map](project-map.md) to find files and [Contributing](../../CONTRIBUTING.md) for setup, checks and releases. This guide explains the behavior to preserve when changing a feature.

## Process boundaries

React views call `window.cortexDl` through `preload.ts`. Backend IPC handlers validate requests before touching files, SQLite or native processes. Add shared contracts in `Shared/` and update the bridge and handler together.

Zustand stores own renderer state. Components display that state; actions submit requests. Keep database, filesystem and child-process work in the backend. Check both English and Arabic layouts, including RTL and reduced motion for animations.

## Download and media processing

`downloadManager.ts` owns queue slots, retries, attempts and final publication. Engines return a result; they do not mark a task complete on their own.

Each attempt owns its callbacks, processes and output candidate. Check ownership before changing task state. Pause and cancellation wait for teardown before a replacement attempt starts. Persist lifecycle changes immediately and batch progress writes.

`services/mediaService.ts` owns format rules, conversion decisions and output validation. Copy compatible streams when possible; trimming or incompatible codecs may require encoding. Validate streams, container and duration before publishing the final file. Preserve required subtitles and artwork.

Temporary files belong to `.cortex_temp/<taskId>/<attemptId>` under the selected destination. Clean only files owned by that attempt. Paused and failed tasks retain partial data for recovery.

## Analysis and previews

Thumbnail/title previews can arrive before formats. Keep the analysis state active until the full request finishes, and show pending quality controls while it runs. Change the displayed stage on real results rather than a timer; show an indeterminate indicator instead of an invented percentage.

Each renderer generation and IPC request owns its updates. Changing or clearing a URL invalidates old results. Identical requests can share extraction work while keeping independent cancellation; the final subscriber stops the child process.

Normalize URLs without losing provider or access information. Bound caches, response bodies, extractor output and deadlines. Do not retain signed media URLs in descriptive metadata caches or log credential contents.

## Playback and trim previews

Media sessions own their streams, native processes and preview requests. Close them on cancellation, player close or shutdown. Range responses must match the requested bounds and actual file size, and playback must wait for the media server to listen.

Visual Trim uses a supported progressive stream or synchronized video/audio pair. Keep the analyzed duration as the trim bound, validate codec support, and leave controls usable when preview extraction fails.

Cover edits temporarily release the file, then restore playback position, volume, speed, pause state and subtitle selection. Optional artwork or diagnostics must not block ordinary playback.

## Media library and artwork

Imports save catalog references without moving or probing every source file. Reopening uses saved metadata and checks availability for the visible page. Thumbnail workers share bounded slots, deduplicate work and reuse valid cached images.

Explicit cover edits preserve media packets, tags, chapters and subtitles. Verify the replacement before committing it, and roll back if the save fails. Formats without embedding support keep library-only artwork.

After an embedded edit, notify Windows that the file changed. Optional Media Player/VLC cache refresh touches only matching entries and keeps backups; cache failure must not undo a saved cover. Media Player may close gracefully. VLC may need reopening to discard an image held in memory.

## Local subtitles

The subtitle service coordinates model readiness, transcription, translation and export. Downloads use the versions and hashes in `subtitles/manifest.ts`. GPU selection can fall back to CPU when needed.

Preserve speech gaps and source timestamps. Keep reviewable transcripts when translation fails, and drain native work before canceling or clearing a session. Subtitle merging validates the result while preserving compatible audio/video streams.

## Startup and engine provisioning

`bootstrap.ts` sets up diagnostics and the single-instance lock before loading backend services. Show the shell and history independently of engine provisioning. Defer optional work until the first usable interface.

Engine receipts bind the locked package, digest, version, file size and modification time. Healthy unchanged receipts avoid hashing or launching engines again. Installation, repair, changed files and execution failures require deeper verification. Share checks for the same engine and verify only the tools a workload needs.

Keep engine URLs, versions, hashes and notices consistent. Development uses `app/engine-baseline`; installed engines live in the app's user-data folder. Shutdown aborts and drains verification, downloads and media work before exiting.

## Generated files

Stop running development and validation processes, preview cleanup with `npm run clean:preview`, then use `npm run clean`. `clean:packaged` also removes unpacked Windows builds, which must be rebuilt before artifact checks.

Cleanup preserves dependencies, staged engines, installers, `.env`, partial downloads and user data. `app/build/installer.nsh` is source, not generated output.

[Code map](project-map.md) · [README](../../README.md)
