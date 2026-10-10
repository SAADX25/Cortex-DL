# Cortex-DL startup validation

Validated on Windows on 2026-10-10. Work is on `codex/instant-startup-engine-receipts`, based on commit `2709491d829aca252d7960b047fa693cdfc0abdc`. This is a local validation candidate; no release was published.

## Bottleneck and startup order

The bottleneck was `runSetup()` calling `engineHealth()` on every launch. It hashed all four full executable files and started their version processes. `App.tsx` returned only `SetupOverlay` until setup became ready. Backend services and updater initialization also depended on completing setup. Version and JS-runtime health requests could launch further probes, including a synchronous Deno runtime probe. Development's predev staging also rehashed and extracted unchanged engine packages.

Previously: native database/backend imports → Electron ready → start media server → construct DownloadManager and begin fragment cleanup → load/show window and create tray → deep engine checks/provisioning → updater/services → remove setup overlay.

Now: minimal bootstrap → Electron ready → database/backend imports → core IPC → construct history manager and load/show window → tray → first React paint → optional updater, media-server binding, cleanup, and required engine verification. A metadata-only receipt check runs asynchronously alongside renderer startup. It does not gate rendering. Download history remains available independently of engine provisioning, and new workloads check their particular engine dependencies.

`cached-ready`, `background-check`, and `ready` keep the main application mounted. `repair-required`, `repairing`, `degraded`, and `fatal` display the actionable repair/setup overlay over the mounted application. Healthy normal startup never displays that overlay.

## Receipt and integrity architecture

Each engine has an atomic JSON receipt in the user-data `bin` directory. It records schema, engine name, expected filename, manifest identity, authenticated executable SHA-256, size, mtime, validated executable version, verification time, and an execution-failure flag when applicable. The manifest identity includes the package's locked version, archive checksum, architecture, source and engine specification. Explicit authenticated yt-dlp updates retain their selected digest/version until the locked manifest changes.

The cheap path reads bounded small metadata files and stats the executable. It compares name, filename, manifest identity, expected digest/version, size and mtime. It never opens executable contents or starts a process. Receipt and baseline metadata bodies are bounded to 64 KiB; malformed or oversized metadata cannot establish readiness.

Deep checks retain full SHA-256, executable-format/PE architecture validation, supported-version validation, pinned expected-version checks, and bounded executable version probes. Legacy SHA-only receipts migrate through a real deep check once. Missing trusted ZIP-engine digests require obtaining and validating the pinned archive; an arbitrary binary cannot establish trust by hashing itself.

Deep verification is required for installation, newly downloaded or updated engines, explicit Repair Engines, missing/malformed receipts, changed size/mtime, changed manifest/expected version, and recorded OS execution failures. A changed ZIP-package manifest requires validating the new pinned package when an authoritative executable digest is unavailable. Optional periodic verification is not enabled; unchanged healthy launches do not run it.

One shared queue serializes required deep checks. Concurrent requests for the same engine share a promise, including concurrent repair requests. Cached engines bypass the deep-check queue even when another engine is being verified. yt-dlp analysis/preview/comments require yt-dlp and Deno; download, conversion, probing, and subtitle paths ensure their FFmpeg/ffprobe dependencies before use. Normal provider and invalid-media errors do not invalidate executable trust; OS launch failures do.

Verification processes run below normal priority when Windows permits it. Hashing uses asynchronous streams; there is no synchronous version probing. Checks yield between engines, perform no encoding, and start after first paint. Shutdown aborts hash streams, version subprocesses, engine downloads and archive extraction, drains verification/setup work, and prevents deferred startup jobs from beginning during quit. Exceptions become failed engine health and actionable repair state rather than an uncaught startup exception.

Media endpoint IPC waits for the server's actual listening event and final port. Playback can wait for that service without delaying the shell. Updater import/checks and the health panel's external update-service request wait for first usable UI. Update network promises are independent of startup readiness.

Development staging stores its own verified metadata in the baseline manifest. Unchanged staging skips hashing, archive extraction and executable probes. `node scripts/stage-engines.cjs --force` performs authoritative staging again.

## Measured results

Healthy second launches, measured in milliseconds from Electron process startup unless stated otherwise:

| Launch | Window shown | UI interactive | Shown → interactive | Cheap receipt check | Engine check | Engine processes | Engine bytes hashed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Previous source | 676* | 6,318 | 5,642* | — | 5,211.43 deep | 5 | 452,605,999 |
| New compiled development | 532 | 554 | 22 | 26.25 | 7.94 metadata | 0 | 0 |
| New packaged EXE | 452 | 483 | 31 | 18.48 | 7.42 metadata | 0 | 0 |
| New packaged EXE, 500 history records | 518 | 554 | 36 | 17.29 | 7.16 metadata | 0 | 0 |
| Actual `Cortex_Dev.bat` | 1,465 | 1,576 | 111 | 14.00 | 9.29 metadata | 0 | 0 |

\* The previous measurement is its ready-to-show marker. The candidate records the completion of `show()`. First-interactive markers use the rendered application's first stable paint.

The packaged application's first-interactive marker improved from the previous source's 6,318 ms to 483 ms, approximately 92%. This is a single measured comparison across source and packaged execution, not a statistical guarantee. Normal launches perform **no full SHA-256 reads and no engine verification subprocesses**, including after first paint.

The actual batch invocation took 9,838 ms to window shown and 9,949 ms to interactive UI. Electron itself took 1,465/1,576 ms; the remaining approximately 8,373 ms precedes Electron startup in npm/predev/Vite. The packaged invocation took 1,955 ms to window shown (452 ms measured inside Electron), so invocation latency and Electron uptime must not be conflated.

Receipt migration on the packaged EXE rendered usable UI at 561 ms. Its required deep verification took 6,434.02 ms **after** first UI, launching four version processes and hashing 452,605,999 bytes. Before UI it launched zero engine processes and hashed zero engine bytes. The subsequent launch used those authoritative receipts. Both migration and healthy launch had the shell mounted, 25 buttons rendered, and no setup overlay because engines were present and required receipt migration only.

For the healthy packaged empty profile, DB open took 3.19 ms, DownloadManager construction 0.37 ms, and deferred fragment cleanup 0.51 ms. With 500 paused records these were 4.41, 27.58, and 1.02 ms; first UI was 554 ms. History recovery was measurable but did not justify moving essential recovery out of construction for these fixtures. Updater initialization started at 484 ms, after first UI at 483 ms, and took 24.35 ms. It did not gate readiness.

The existing installed EXE was unavailable at measurement time (`installedBefore: null`). An installed-versus-development comparison therefore remains unavailable. The real newly built packaged executable, `app/release/2.2.0/win-unpacked/Cortex DL.exe`, was validated directly; the NSIS installer was built successfully without replacing the user's installation.

Raw results: [startup comparison JSON](../smoke-results/startup-comparison.json), [benchmark log](../smoke-results/validation/benchmark.log).

Measurements use real Windows Electron processes and real pinned binaries. The benchmark seeds legacy SHA receipts, runs authoritative migration in the application, then measures a second launch using the resulting receipts. It asserts zero verification subprocesses, zero full hash reads and zero hashed engine bytes on the healthy second launch. It also inspects the rendered shell and confirms no setup overlay, and checks that updater and background engine work begin after first paint. Timing values are observations, with no fixed millisecond pass/fail assertions.

The prior source snapshot adds measurement counters, a deep-health duration timer and a first-interactive marker only. Its `uiMs` is the previous ready-to-show timestamp; the new implementation records after `show()` returns and also records wall-clock milestones. The actual batch-launch measurement includes npm/predev/Vite overhead, which the compiled-development measurement excludes. Installed-baseline availability is reported separately; the new candidate is exercised through its real packaged EXE in `win-unpacked`, without replacing the user's installation.

DownloadManager/DB/fragment cleanup measurements include an empty profile, persisted-history smoke restarts, and a 500-record paused-history benchmark. Recovery remains synchronous and safe; optional fragment cleanup runs after UI readiness. Results apply to these fixtures rather than an arbitrary-size user history database.

## Tests, packaged validation and regressions

| Required command | Final result | Evidence |
| --- | --- | --- |
| `npm test` | PASS, 134/134 | [log](../smoke-results/validation/test.log) |
| `npm run test:unit` | PASS, 31 + 12 + 26 = 69/69 | [log](../smoke-results/validation/unit.log) |
| `npm run test:integration` | PASS, 92/92 | [log](../smoke-results/validation/integration.log) |
| `npm run typecheck` | PASS | [log](../smoke-results/validation/typecheck.log) |
| `npm run lint` | PASS, zero warnings | [log](../smoke-results/validation/lint.log) |
| `npm run build` | PASS, production EXE and NSIS installer; publish disabled | [log](../smoke-results/validation/build.log) |
| `npm run test:packaged` | PASS, first setup, repair, offline restart and media lifecycle | [log](../smoke-results/validation/packaged.log) |
| `npm run benchmark:startup` | PASS, compiled development, real packaged EXE, 500-record history and actual batch launcher | [log](../smoke-results/validation/benchmark.log) |
| `git diff --check` | PASS | [log](../smoke-results/validation/diff-check.log) |

The commands overlap in coverage; their test counts should not be summed into a unique-test total. The focused final receipt/setup/startup-health run also passed all 26 tests. Successful final packaged runs reported no startup/main/renderer crashes and ended with zero tracked streams, FFmpeg processes, probe processes and media sessions. The packaged smoke's 88,553 ms first run and 82,313 ms repair/restart sequence are whole scenario runtimes, including provisioning and playback; they are not window startup measurements.

The deterministic startup tests cover requirements A–L: healthy second startup has no hashes/processes and is immediately cached-ready; mtime/size and manifest/version changes invalidate trust; missing/corrupt engines cannot become ready; UI precedes deferred verification; exceptions are contained; first use waits only when required; concurrent callers share verification; updater network access waits for usable UI. Additional tests cover repair racing cached inspection, cached engines bypassing another engine's deep check, oversized metadata, untrusted missing digests, persistent failure invalidation, shutdown cancellation, and early media endpoint requests using the final bound port.

Packaged smoke exercises real first-run downloads, deliberately corrupt FFmpeg repair, a healthy offline restart, persisted SQLite history, direct download, native module loading, setup animation/progress, authenticated media/range requests, video ×10, audio ×20, and Visual Trim ×20. It checks shutdown and zero remaining tracked streams/processes/sessions.

Validation initially exposed a merge test assuming synchronous process creation; it now waits for the actual child before pausing/canceling. A packaged playback failure prompted fixing the early-media-endpoint readiness gap and adding a deterministic regression plus richer smoke failure diagnostics. One packaging attempt lost its temporary extracted Electron executable; retry succeeded. Windows sandbox restrictions on atomic executable-receipt renames required running the real filesystem/process validations with normal Windows permissions. These were validation findings, not suppressed failures.

## Exact changed files

37 source, test, configuration and documentation files changed. Local builds, smoke profiles and instrumentation snapshots are ignored artifacts.

```text
app/Back-End/electron/analysisProcess.ts
app/Back-End/electron/commentsExtractor.ts
app/Back-End/electron/db.ts
app/Back-End/electron/engineIntegrity.ts
app/Back-End/electron/engineReadiness.ts (new)
app/Back-End/electron/engineReceipts.ts (new)
app/Back-End/electron/engines/MediaProcessor.ts
app/Back-End/electron/engines/YoutubeEngine.ts
app/Back-End/electron/entrypoint.ts (new)
app/Back-End/electron/ipc/handlers.ts
app/Back-End/electron/main.ts
app/Back-End/electron/mediaFiles.ts
app/Back-End/electron/mediaPipeline.ts
app/Back-End/electron/preload.ts
app/Back-End/electron/previewExtraction.ts
app/Back-End/electron/setup.ts
app/Back-End/electron/startupTiming.ts (new)
app/Back-End/electron/startupWork.ts (new)
app/Back-End/electron/ytdlp.ts
app/Front-End/src/App.tsx
app/Front-End/src/components/SetupOverlay.tsx
app/Front-End/src/vite-env.d.ts
app/docs/startup-architecture.md (new)
app/package.json
app/scripts/stage-engines.cjs
app/scripts/startup-benchmark.cjs
app/tests/analysisPerformance.test.cjs
app/tests/coreV2.test.cjs
app/tests/engineReceipts.test.cjs (new)
app/tests/engineSetup.test.cjs
app/tests/reliability.test.cjs
app/tests/startupHealth.test.cjs
app/tests/trimPreview.test.cjs
app/tests/youtubeAccess.test.cjs
app/tests/youtubeSubtitles.test.cjs
app/vite.config.ts
package.json
```

