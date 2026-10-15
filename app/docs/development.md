# Development guide

## Layout and commands

The application package and lockfile live in `app`. The repository root provides npm shortcuts, the development launcher, branding and contributor documents. Run `npm run setup` to install locked dependencies, `npm run dev` to stage engines and launch development, `npm run check` for TypeScript, ESLint and tests, and `npm run build` to build the Windows installer. Tests that invoke media tools need `engine-baseline`; first-time installation and staging require network access.

React views live in `Front-End/src/components`; hooks, actions and renderer helpers live in their corresponding directories. Zustand stores own shared renderer state. Update Arabic and English translations together and check RTL layouts. Shared IPC types live in `Shared`. Keep filesystem, database and child-process work behind validated backend IPC handlers and the preload bridge.

## Download and media processing

`downloadManager.ts` owns queue slots, retries, pause/resume, task transitions and final publication. Each attempt has an isolated runtime and output candidate. Callbacks must still own that attempt before mutating state; pausing waits for teardown before a replacement attempt starts. Engines return results to the manager instead of committing completion themselves. Persist lifecycle changes immediately and batch progress writes.

The media format registry decides between direct output, remuxing, audio encoding, video encoding and full transcoding. Copy compatible streams; accurate trims and incompatible or unknown codecs require encoding. Validate output streams, container and duration before publishing a final file. Finalization must retain required subtitles and artwork and remain cancelable.

Media requests own their streams, processes and preview sessions through a shared registry. Close streams, terminate owned process trees and drain work on cancellation or shutdown. Range responses must respect the requested bounds and actual file size. Playback waits for the media server's listening event and final port.

## Analysis and previews

Normalize URLs without discarding provider identity or authentication parameters. Publish available thumbnail/title metadata early; full extraction and optional enrichment arrive independently. Each renderer generation and IPC request owns its updates, so input changes and disposal invalidate stale results. Identical analysis requests share bounded extraction work with independent cancellation; the final subscriber cancels the child process.

Metadata caching is bounded and scoped to URL and cookie-file identity. Cache successful descriptive metadata without signed media URLs. Bound network bodies, extractor output and deadlines, and drain children before releasing concurrency slots. Cookie validation shares unchanged-file results without retaining or logging cookie contents.

Visual Trim extracts a fresh supported progressive resource, or a synchronized video/audio pair for adaptive media. Preserve the analyzed duration as the trim bound. Validate URLs and codec support, use the analyzed fallback once, and keep trim controls usable on preview failure. Closing a preview detaches media elements and cancels its extraction session.

Player diagnostics retain actual media errors and session context. Keep playback independent of optional artwork, diagnostics and external metadata requests.

## Media library and artwork

Library import validates paths and persists metadata in one durable catalog commit without probing or modifying source media. Reopening uses saved catalog data rather than scanning every source. Inspect availability for the current page. Thumbnail workers share bounded slots, deduplicate requests and look up a valid disk cache before probing. Cache identity includes source metadata; invalid entries are regenerated. Discovery still checks attached pictures on supported audio and video formats.

Explicit cover edits verify the source, preserve audio/video packets, tags, chapters and subtitles, replace existing attached pictures, and use backup/rollback before committing the catalog. Unsupported embedding formats retain library-only artwork. After a committed embedded edit, send a Windows shell update notification. Optional Media Player and VLC refresh touches only recognized matching cache entries and keeps backups; a cache failure must not roll back a saved cover. Media Player may close gracefully when a matching stale cache exists; VLC requires reopening to discard images held in memory. Unknown cache formats and redirected paths are skipped.

## Startup and engine provisioning

Bootstrap configures diagnostics, safe mode and the single-instance lock before loading native database/backend modules. Load the shell and history independently of engine provisioning. Defer updater checks, optional cleanup and required verification until the first usable UI. Keep the application mounted while showing actionable setup or repair state.

Engine receipts bind the locked manifest, expected digest/version, executable size and modification time. Unchanged trusted receipts establish readiness through bounded metadata reads without hashing executables or launching version processes. Installation, repair, changed metadata and OS execution failures require deep digest, architecture and version checks. Serialize deep checks and share concurrent requests for the same engine; cached engines can proceed independently. Each workload checks only its required engines.

Shutdown aborts and drains provisioning, hashing, verification and media work before exiting. Development uses `engine-baseline`; mutable runtime engines live in user AppData. Keep `engines.lock.json`, third-party notices, build metadata and release checks consistent. Preserve `build/installer.nsh` during cleanup.

## Generated files

Use `npm run clean:preview` to inspect cleanup and `npm run clean` to remove generated development output. `npm run clean:packaged` also removes unpacked Windows builds in versioned release directories; rebuild before validating those artifacts. Cleanup preserves dependencies, staged engines, installers, `.env`, `.cortex_temp` and user history/settings. Stop development and validation processes before cleanup and inspect temporary media manually.
