# Downloader Core V2 implementation report

Implementation branch: `codex/downloader-core-v2`.

## Observed problems

- `pause()` deleted the engine and active slot before `download()` settled; `resume()` reused the same runtime and task object. Old callbacks/finally blocks could modify or release the next attempt.
- YoutubeEngine and the FFmpeg function committed completion, notifications, and statistics independently. Abort guards were missing after several finalization awaits.
- Direct and FFmpeg wrote to the final pathname. yt-dlp had a second conversion/validation/promotion implementation.
- Direct cached HEAD metadata across attempts without ETag/Last-Modified/If-Range protection; positional writes assumed a complete write.
- Overall progress used fixed 90/99 weights and monotonic clamping. FFmpeg output size/bitrate could overwrite yt-dlp network byte counts.
- Trim implementations differed by engine, used potentially inaccurate stream copy, and lacked verified duration checks.
- Restart recovery did not cover pausing/queued states or distinguish certified completion from legacy/partial output.
- A real SQLite restart test additionally exposed a stale speed on a recovered legacy completion.
- The PID existence check could miss a just-spawned child, and nonzero taskkill results had no direct-kill fallback. A bounded immediate-shutdown test now prevents natural process exit from producing a false pass.
- Global HTTP agent reuse and delayed write-behind timer retirement could leave resources alive beyond the attempt; both now have explicit attempt/transition cleanup.

## Architecture and behavior

Every execution creates an AttemptRuntime with a UUID, controller, child handle, settlement promise and `.cortex_temp/<taskId>/<attemptId>` directory. Engines receive an isolated task draft. Only a guarded DownloadManager projection updates the authoritative task consumed by SQLite and IPC. Concurrent process-tree shutdown calls share one teardown promise; POSIX children have their own process group. Engines return typed outcomes; manager owns final transitions, retry eligibility, notifications and statistics.

Pause marks `pausing`, aborts the attempt and waits for all engine I/O/process work to settle. Resume waits for settlement before scheduling a fresh runtime. Cleanup checks runtime identity before releasing slots/engines. Delete waits for cancellation; final paths are removed only if recorded as task-owned. Cancel and `deleteFile=false` preserve published final files.

Partial directories transfer to the new attempt only after the old attempt settles. Direct rechecks HEAD identity each attempt, uses strong ETag or Last-Modified in If-Range, rejects response identity/range mismatches, and discards suspect bytes before full-stream fallback. Parallel writes use explicit offsets and handle short writes; siblings settle before descriptor close. HTTP/HTTPS agents belong to the engine attempt and are destroyed on exit; task write-behind dirtiness/timer is retired after the durable final transition. Retry timers and stall watchdogs are bounded and abortable.

All engines feed one finalization path: candidate -> source probe -> optional registry conversion/accurate re-encoded trim -> output probe/container+codec+duration validation -> full FFmpeg decode with `-xerror` -> current-attempt check -> exclusive atomic pathname publication -> current-attempt check -> synchronous authoritative commit. Publication uses a same-volume hard link to avoid rename's ability to overwrite unrelated destinations. Candidate and subtitle links are rolled back on interruption before commit. No async gap exists between the final guard and Completed/statistics/notification.

The registry covers MP4/M4V/MOV/MKV/WebM/AVI/OGV/GIF and MP3/AAC/M4A/WAV/FLAC/OGG/OPUS/WMA. It selects remux for compatible codecs or encode when needed. Compatible embedded subtitles and metadata survive conversion. Existing yt-dlp auth, cookies, quality, subtitle and metadata options remain; the settings engine updater remains available.

Metadata uses the same quality selector as the download; observed totals replace estimates once all selected streams are reported. Validation/finalization phases survive a compatible yt-dlp merge. Progress separates actual network bytes, total bytes, speed, ETA, phase progress and overall display. Unknown-duration processing/validation/finalization is indeterminate. Numeric phase progress is real observed work; 100 overall is reserved for verified completion. `outputBytes` independently records final file size. FFmpeg encoding bitrate/output size are not counted as network transfer. No timer advances percentages.

## Removed or replaced code, with usage evidence

- Engine-owned terminal state, statistics, notification and retry scheduling: replaced by the manager; EngineContext no longer exposes final statistics or retry mutators.
- YoutubeEngine's private `finalizeDownloaded`, probe/conversion/video-argument helpers: replaced by shared finalization and the format registry. New manager tests replace tests that invoked this deleted private implementation.
- The old ffmpegEngine availability subprocess, per-format switch, trim, terminal and retry code: replaced by tracked media processes and the registry.
- `MediaProcessor.merge/convert`: no callers/import-based or dynamic dispatch paths. The only dynamic import is `ipc/handlers.ts`, whose media-FPS handler calls `getFps` and tracks `killAll`. Both used methods remain.
- `taskDb.updateStatusAndProgress`: no callers; manager persistence uses upsertTask, including authoritative progress/full payload.
- Download-time shared yt-dlp self-update promise/process: duplicate updater path with unowned lifecycle; settings/preload/IPC `updateEngine` -> `updateYtdlp` remains intact.
- Fixed progress phase weights, monotonic clamping, FFmpeg bitrate-as-speed, quality-mismatched metadata totals and stale trim preseed logic: replaced by actual phase measurements and the shared trim stage.
- Obsolete comments/imports/runtime lookup helper and the unnecessary untracked batch scheduling timer.

No IPC/preload channels, player FPS workflow, SQLite task storage, React download store or functioning user controls were removed. The public progress-channel constant was retained rather than assumed dead from a text search.

## Regression coverage

`tests/coreV2.test.cjs` adds attempt settlement/fast resume with an intentionally suspended old engine; stale progress/success; active deletion; retries freeing slots; cancellation at both ffprobe boundaries, media/subtitle publication; atomic no-overwrite; corrupt headers and corrupt payload; delete true/false; real FFmpeg conversion for all 16 formats; six real audio/video trim combinations; real merge/conversion/trim pause/cancel and restart; Direct Range scoped resume/socket cleanup; ETag/Last-Modified changes; yt-dlp video/audio identity aggregation; real YoutubeEngine success/pause/cancel with process retirement; subtitle-preserving MP4 remux; real SQLite WAL abrupt-exit/restart recovery.

`tests/reliability.test.cjs` retains direct chunk/resume/fallback, real yt-dlp template, all audio encoders, authoritative progress/IPC/SQLite projection checks, with assertions updated for manager-owned completion. `tests/mediaLifecycle.test.cjs` continues testing player/stream resource disposal.

Real binary tests require the bundled tools, rather than silently substituting mocks. SQLite tests run in the bundled Electron Node runtime because better-sqlite3 is compiled for Electron's native ABI (123), not the host Node ABI (137).

## Validation

- `npm run typecheck`: passed, exit 0.
- `npm run lint`: passed, exit 0, no warnings.
- `npm run test:unit`: 16 passed, 0 failed, 0 skipped.
- `npm run test:integration`: 39 passed, 0 failed, 0 skipped. HTTP/timer cleanup refinements were also checked with 8 focused Direct/yt-dlp tests afterward.
- Final `npm test`: 39 passed, 0 failed, 0 skipped; 187.924 seconds. This run includes the final HTTP/timer/process teardown and progress fixes.
- `npm run build -- --publish never`: passed, exit 0; TypeScript, renderer/main/preload bundles, Electron native rebuild and Windows NSIS installer completed. Nothing published.
- `git diff --check`: passed.

Installer: `G:/Cortex DL/app/release/2.0.0/Cortex DL Setup 2.0.0.exe`.


## Remaining limitations and tradeoffs

- Full decoding and precise re-encoding increase finalization time/CPU. Trimming downloads the full source first, including yt-dlp sources, to make source reuse and resume safe.
- Atomic exclusive hard-link publication requires a filesystem supporting hard links (tested on this Windows filesystem). Unsupported filesystems fail safely rather than falling back to exposing a partial final output.
- Legacy completed rows without a V2 validation certificate are conservatively restored as paused; files are retained. Legacy final paths without explicit ownership records are not deleted automatically.
- SQLite and filesystem publication are not one cross-system transaction. Abrupt process termination after publication but before the SQLite commit can leave a valid, unrecorded final file; recovery never treats an uncertified row/partial as Completed and never deletes that unproven file.
- Real yt-dlp integration exercises a local HTTP origin. Live provider authentication, bot restrictions and remote service changes were not tested against YouTube accounts.
- This work does not include a manual GUI acceptance session or installer launch. Typecheck/build verify the existing UI's new phase wiring; player regression tests remain green.

## Files changed

- `app/Back-End/electron/audioFormats.ts`
- `app/Back-End/electron/db.ts`
- `app/Back-End/electron/downloadManager.ts`
- `app/Back-End/electron/engines/DirectEngine.ts`
- `app/Back-End/electron/engines/FfmpegEngine.ts`
- `app/Back-End/electron/engines/IEngine.ts`
- `app/Back-End/electron/engines/MediaProcessor.ts`
- `app/Back-End/electron/engines/YoutubeEngine.ts`
- `app/Back-End/electron/ffmpegEngine.ts`
- `app/Back-End/electron/mediaFiles.ts`
- `app/Back-End/electron/mediaFormatRegistry.ts`
- `app/Back-End/electron/mediaPipeline.ts`
- `app/Back-End/electron/progressParser.ts`
- `app/Back-End/electron/types.ts`
- `app/Back-End/electron/utils.ts`
- `app/Front-End/src/components/DownloadCard.tsx`
- `app/Front-End/src/hooks/useDownloadCardVM.ts`
- `app/Front-End/src/hooks/useHighFrequencyIPC.ts`
- `app/Shared/progressModel.ts`
- `app/Shared/types.ts`
- `app/package.json`
- `app/tests/reliability.test.cjs`
- `app/tests/coreV2.test.cjs`
- `app/tests/fixtures/sqliteRecovery.cjs`
- `app/docs/downloader-core-v2.md`
