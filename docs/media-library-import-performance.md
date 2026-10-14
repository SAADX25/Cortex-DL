Media library import performance audit — 2026-10-14

Work is on `codex/media-import-performance`, based on latest master at `919e6a1c841468878a36e7369731ac3bb5ac5d56`. The measured delay occurs after cards appear. Import is already a fast metadata operation. The repeatable bottleneck is FFprobe running before the thumbnail disk-cache lookup, including on a warm cache after restarting workers. Discovery is preserved for every supported format: non-editable videos such as MKV still prioritize attached covers, and the player artwork menu consumes embedded-cover flags for additional audio formats. Only the redundant cache-hit probe is removed.

The initial baseline was reported before production edits: 28–101 ms to cards; 1.06–2.24 seconds to a first thumbnail; a fresh 1,200-file backend import took 53.11 ms, including 4.01 ms persistence and 0.87 ms JSON serialization. Those observations ruled out a storage migration or staged import. Later instrumented runs below measure full-size imports with empty catalogs and fresh thumbnail workers for every case.

Measurements use real Electron 44.5.1 IPC, the production React/Zustand/library components, and the repository's real FFmpeg/FFprobe executables. Fixtures contain an MP3 with an embedded cover, an MP4, and a WAV without artwork, copied to unique paths up to 1,200 files. Files and catalogs are generated in an isolated temporary directory. Engine receipt readiness is stubbed in the timing harness so engine provisioning/hash verification is excluded; packaged smoke tests exercise real receipts and repair. Results are observations from this Windows host, not timing guarantees or averages. Other process and filesystem load varies between runs.

The original source is loaded from Git by the benchmark's `--baseline` option; it does not switch branches or modify working files. Renderer/main clocks are calibrated using the lowest round trip of 20 clock requests. DOM commit and image load are recorded, and displayed-card/image times are sampled after two animation frames. These are presentation bounds, not compositor-level timestamps. Renderer clocks have roughly 0.1 ms resolution. Electron does not expose serialization and delivery as separate timings: the response column measures both together.

| Files | Import IPC before → after (ms) | First card before → after (ms) | First cold image before → after (ms) |
| --- | ---: | ---: | ---: |
| 1 audio | 6.90 → 5.90 | 33.20 → 32.90 | 2517.30 → 2249.20 |
| 3 mixed | 5.00 → 4.50 | 34.10 → 33.40 | 2600.10 → 2149.30 |
| 100 mixed | 15.00 → 34.50 | 32.80 → 50.20 | 4549.30 → 2200.20 |
| 1,200 mixed | 130.40 → 73.10 | 167.20 → 99.80 | 4207.10 → 2230.90 |

Import code is unchanged, so its observed differences should be attributed to measurement/load variation rather than an import-algorithm improvement. The 100-file after sample spent 24.66 ms in response delivery/renderer scheduling despite a 9.52 ms main handler; first cards still appeared at 50.20 ms. The clear cache improvement is a worker-restart request for an already generated MP3 thumbnail: **1229.65 → 4.00 ms**, **one FFprobe → zero child processes**. Cold embedded MP3 discovery still requires FFprobe plus FFmpeg. Removing cache-hit probes and sharing two slots bounds work; it does not eliminate cold extraction, and scheduling can increase cold waits for some mixtures.

| Scope for 1,200 files | Before (ms) | After (ms) |
| --- | ---: | ---: |
| Main import handler | 125.08 | 69.68 |
| Validation/load/path work before save, wall time | 110.81 | 62.51 |
| Atomic save, including JSON | 13.39 | 6.91 |
| JSON serialization within save | 2.45 | 1.21 |
| Request delivery | 1.07 | 1.13 |
| Response serialization + delivery | 4.25 | 2.29 |
| IPC resolved to Zustand notification | <0.1 | 0.1 |
| Zustand notification to first DOM card commit | 4.40 | 2.20 |
| Separate fresh backend import, without renderer | 103.79 | 61.69 |
| Duplicate-only import of all 1,200 references | 12.31 | 6.32 |

For the one-audio baseline, optional discovery took 1244.85 ms and thumbnail extraction/cache work took 1215.50 ms. Afterward, discovery took 1113.52 ms and the combined thumbnail worker took 2184.12 ms; discovery is now inside that worker, so these durations overlap and must not be added. Raw records include every probe/thumbnail call and filesystem operation's duration and count. Filesystem totals sum overlapping operations and are not wall time.

Native human file-picker interaction has **not** been measured. A controlled 150 ms dialog fixture measured 165.64 ms before and 156.44 ms afterward; the total select IPC took 170.90 ms and 159.90 ms respectively. The remaining 5.26/3.46 ms is processing/IPC in this duplicate-selection case. This fixture demonstrates separation of dialog wait from processing; it cannot diagnose Windows shell delays, remote folder enumeration, or a user's selection time.

Each fresh import performs exactly N source `stat` calls and N read-access calls, with a peak of 32 inspections, and one catalog mkdir/open/write/sync/close/rename plus temporary-unlink attempt. Import launches zero child processes. Duplicate-only imports perform no source inspection or save. Reopening the catalog uses saved JSON and performs zero source scans; only current-page availability checks run afterward. The existing 1,200-file regression measured 10.4 ms to open under full-test load while a deliberate full scan took 591.8 ms.

| Cold first-page requests | FFprobe before → after | FFmpeg before → after | Observed process peak before → after |
| --- | ---: | ---: | ---: |
| 1 audio | 1 → 1 | 1 → 1 | 1 → 1 |
| 3 mixed | 3 → 3 | 3 → 3 | 2 → 2 |
| 100 mixed | 3 → 3 | 3 → 3 | 2 → 2 |
| 1,200 mixed | 3 → 3 | 3 → 3 | 2 → 2 |
| Warm cached MP3 after worker restart | 1 → 0 | 0 → 0 | 1 → 0 |

Only near-viewport items on the current page request thumbnails; the harness's viewport requested three items in the mixed cases. The original code allowed two probe processes and two extraction processes independently; an earlier baseline observed four combined. Discovery and extraction now share the existing two thumbnail slots, with a regression that verifies a peak of two across both stages. Concurrent requests for one cache key share discovery and extraction. No new queue, IPC channel/event, or progress stream was introduced.

The warm request performed 19 `stat`, one mkdir/readdir, and one read before; afterward it performed 22 `stat`, one `lstat`, one mkdir/readdir, and two reads. Counts include the initial bounded cache cleanup scan. Small metadata reads/cleanup replace a child-process launch; this change is not a filesystem-operation reduction.

The fix adds a bounded, validated `.info` sidecar to the disposable thumbnail cache. Its embedded flag shares the existing source size/mtime and nearby-cover cache key. Legacy images with matching keys are usable and gain metadata lazily; corrupt metadata is repaired without re-decoding a valid image. Legacy images whose keys included a discovered stream index regenerate once under the new discovery-independent key. Corrupt JPEG signatures regenerate; image decode failures retain the icon and never block playback. Failed discovery remains retryable, and negative cache entries retain cover controls when extraction fails. Cache cleanup includes the new sidecars. The `media-library.json` version, format, limits, atomic persistence, and existing library data are unchanged.

UI layout/CSS are unchanged. Thumbnail completion subscriptions belong to the affected row's cover controls, and thumbnail components are memoized. Optional artwork never acquires the store's global busy flag. Icons remain lightweight placeholders, and playback can start while artwork is pending. Large dropped batches show `Adding 1,200 files…`; picker-based imports show `Adding media…` because their selected count remains inside the existing single IPC call. No progress percentage or committed-file count is invented. Results become visible only after the backend's durable catalog commit.

Normal import never writes source media, embeds covers, or invokes external-player synchronization. Explicit cover actions retain the existing source verification/backup/rollback and opt-in player refresh. Source/path authorization and symlink/junction protections remain in the existing modules. Worker shutdown drains queued discovery/extraction and kills owned child processes.

Changed production files: `app/Back-End/electron/ipc/mediaLibraryIpc.ts`, `app/Back-End/electron/libraryThumbnails.ts`, `app/Front-End/src/components/LibraryThumbnail.tsx`, `app/Front-End/src/components/MediaLibrary.tsx`, and `app/Front-End/src/stores/useMediaLibraryStore.ts`. `mediaLibrary.ts`, `audioArtwork.ts`, catalog storage, download code, and media-player code were inspected and left unchanged. Supporting changes add `app/scripts/media-library-benchmark.cjs`, `app/tests/fixtures/mediaLibraryBenchmark.jsx`, targeted cases in `libraryThumbnails.test.cjs`, `mediaLibrary.test.cjs`, and `mediaLibraryIpc.test.cjs`, and held-artwork/import assertions in the existing UI fixture/test.

Validation: `npm test` passed 219/219 tests; the final media regression set passed 24/24 (including the protected preload), and the additional UI and MKV IPC checks passed. `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. `npm run test:packaged` passed its actual Windows EXE smoke suite initially and on the final rebuilt candidate, including all three fresh-install/repair/offline stages, import/playback/persistence, repeated playback/trim, and clean shutdown with zero active streams/processes/sessions. One intermediate repeat timed out at video reload after artwork removal (`readyState: 0`, no store error); the final run, without overlapping builds/benchmarks, passed that same sequence in all three stages. The intermittent timeout's cause has not been established, so this result is retained as a limitation rather than described as fixed. Initial sandbox runs failed on Windows atomic renames/Electron launch; identical tests passed with ordinary Windows process/filesystem access. A new UI assertion initially awaited its own held import; the fixture invocation was corrected and the regression passed.

Coverage includes 1/3/100/1,200 files, duplicates, invalid/missing media, simulated EACCES and disconnected-drive ENODEV, delayed source checks, missing engines/retry, corrupt thumbnail/metadata, concurrent requests/repeated imports, picker cancellation, queued-work shutdown, reopening without rescan, playback before artwork completes, and cover replacement/removal in MP3/FLAC/M4A/MP4 with preserved media streams. Physical disconnected/network drives and real native picker interaction were not benchmarked. Filesystem calls cannot be canceled once issued, so pathological drive latency can still delay a new import's single commit; opening the saved catalog does not wait for a full rescan. No staged import is justified by these local measurements.

Reproduce from the repository root:

```powershell
node app/scripts/media-library-benchmark.cjs app/smoke-results/media-import-before.json --baseline=919e6a1
node app/scripts/media-library-benchmark.cjs app/smoke-results/media-import-after.json
```

Raw JSON and validation logs remain in `app/smoke-results/` (ignored generated artifacts). No release was published and no branch was pushed.
