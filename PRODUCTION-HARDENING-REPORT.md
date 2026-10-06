# Cortex-DL 2.1.5 production hardening review

Prepared before committing, 2026-10-06. Branch: `codex/v2.1.5-production-hardening`, based on latest fetched `origin/master`, `0e82e73ffb07b840e1e4cec99d66780a78a2a22b`. No tag, GitHub release, or push is authorized or performed. This is a review candidate with explicit release blockers, not certification that every requested manual scenario is complete.

## Findings and defects fixed

The main development/installed mismatch was engine bootstrap: development used project binaries while production needed first-run downloads and external ZIP extraction. Existence checks accepted damaged files, setup failure still initialized download services, and runtime selection allowed Node 18 despite current yt-dlp requiring Node 22. Unsupported Electron 30, different native loading, forced GPU flags, weak production diagnostics, and release metadata drift compounded that mismatch.

At the actual master checked out here, package.json was 2.1.0 and the lockfile root was still 2.0.0. The requested historical mismatch was therefore not assumed to match current master. Both now use authoritative package.json version 2.1.5. Vite, About, Electron metadata, artifact names, build manifest, and latest.yml derive from it. Release verification rejects mismatched tags, dirty source, and mismatched artifact version/hash/size/Windows executable metadata. Release builds require HEAD to be exactly the matching tag; ordinary local candidate builds deliberately remain possible without creating a tag.

Other concrete corrections include bounded readiness waits, safe ZIP handling, measured runtime selection, atomic yt-dlp promotion, preservation of pending updater cache, recovery controls on failed setup, sender validation for IPC, token-protected single HTTP ranges (including suffix ranges), media-port conflict fallback, correct self-uninstaller path, and removal of destructive self-uninstall data deletion. Open-file validation permits every existing supported media format.

## Installer and engine architecture

Before: a small application installer, project engines in development, mutable userData engines fetched during production startup, and Windows tar extraction. After: JS remains in ASAR, native .node files are unpacked, and verified yt-dlp/FFmpeg/ffprobe/Deno executables ship under read-only `resources/engines`. Development stages the identical pinned baseline. Mutable updates and repair files live exclusively in userData/bin; media stays in the selected download directory.

Direct extraResources was selected over extracting a second engine archive on first launch. This removes network and extraction dependency from startup and avoids copying approximately 400 MB of healthy engines into each user profile. A valid userData override takes precedence; otherwise the bundled baseline runs directly. A newer working user engine is retained through application updates. Legacy overrides without integrity receipts undergo size/architecture/execution/version validation; their historical authenticity cannot be reconstructed. New updates and repairs record SHA-256 receipts.

Pinned baseline in engines.lock.json:

| Engine | Version | Minimum |
|---|---|---|
| yt-dlp | 2026.08.19 | 2026.06.09 |
| FFmpeg / ffprobe | N-127203, BtbN autobuild-2026-10-05-13-07 | 6.0 / libavcodec >= 60 for development builds |
| Deno | 2.9.4 | 2.3.0 |

Upstream package URLs/hashes and measured per-executable hashes are checked during staging. Startup verifies regular-file size, Windows x64 PE architecture, checksum where available, bounded real execution, exit status, and supported version. Staging is idempotent: it does not overwrite an unchanged executable while tests or downloads use it.

Repair checks components individually, replaces only broken engines, first uses the verified offline baseline, and permits bounded network retrieval only for explicit repair if that baseline is unavailable. Downloading uses HTTPS, a five-redirect limit, header/overall deadlines, three bounded attempts, size limits, AbortController, and temporary files. ZIP extraction rejects traversal, links, duplicates, missing outputs and excessive expansion. Promotion verifies before and after replacement and restores the previous executable on failure. Download services initialize only after mandatory engines are healthy; recovery offers Retry, Repair, Logs, and Exit.

The old 2.1.0 uninstaller unconditionally deleted userData even during upgrade, ignoring the framework preservation option. The new installer protects that legacy data with a same-volume rename before invoking the old uninstaller and restores it afterward. It refuses to move data while Cortex is running or an earlier backup exists. If installation is interrupted, the recoverable folder is `%APPDATA%/Cortex DL.upgrade-2.1.5-backup`; close Cortex, preserve both folders if present, and restore that backup to `%APPDATA%/Cortex DL` before retrying. New uninstall offers removal of the application alone or also its owned data, defaulting to preservation. Downloaded media outside app-owned directories is never targeted.

## Electron, native module, runtime and security

Electron is pinned to 44.5.1, selected from the available stable npm registry release after reviewing official breaking changes and exercising packaged preload, sandbox, media, native SQLite, tray creation, shutdown and installer paths. electron-builder is 26.15.3; the lock resolves electron-updater 6.8.9. Vite is 6.4.3. React 18.3.1 and TypeScript 5.5.4 were retained rather than performing unrelated major migrations.

better-sqlite3 13.0.3 supplies a Node-API prebuild. Under the actual packaged Electron runtime, ABI is 149 and Node-API is 10. The unpacked win32-x64.node opened SQLite, enabled WAL, inserted/read tasks, and restored them across restart. Because v13 uses Node-API rather than the previous Electron-specific ABI binding, npmRebuild is disabled deliberately; an ABI-specific recompilation is unnecessary for this tested compatible prebuild. No destructive schema migration was introduced. The old installer's database was also read and quick-checked using the new runtime.

yt-dlp runtime priority is measured supported Deno, then supported Node (minimum 22), including a measured Electron-as-Node fallback. Mere executable existence or the main process Node version is insufficient. Deprecated Bun fallback was removed. Healthy Deno 2.9.4 was selected in packaged checks.

contextIsolation and sandbox protections remain, Node integration stays disabled, external navigation remains restricted, and all app invoke handlers enforce the owning main-frame sender. Sensitive operations validate URLs, absolute paths, task IDs, concurrency and deletion flags. Existing safeStorage use is retained. Engine executables never execute from ASAR. App/installer signing can use normal electron-builder certificate configuration; upstream engine files are excluded from signing to preserve their pinned hashes. No certificate or password was added.

## Diagnostics, GPU and updater behavior

Rolling production logs are bounded to 2 MiB per file. Startup/build/OS/engine/setup/repair/updater details and uncaught errors, unhandled rejections, renderer failures and child/GPU failures are logged. HTTP URLs and named credential/header secrets are redacted at the logging boundary. Export Diagnostics contains build/OS/engine health/database quick-check/media status and bounded redacted recent logs; it does not collect cookies, downloaded media or database payloads.

Unjustified forced GPU switches were removed. A previous startup left at `starting`, or repeated renderer/GPU failure, offers Continue, Safe Mode restart, or Logs. Safe Mode temporarily disables hardware acceleration, Ambilight and advanced visualizer effects while preserving downloading. Markers record starting/ready/clean-shutdown; they offer recovery rather than declaring data corrupt. There is no endless automatic restart loop.

Application updates remain separate from yt-dlp updates. Downgrades are disabled; destructive updater-cache cleanup was removed. The pinned updater handles semantic version comparisons and its normal interrupted-download cache. Local latest.yml is verified against the real installer SHA-512/size/blockmap. A live published 2.1.0-to-2.1.5 auto-update and interrupted remote installer download were not tested because publishing 2.1.5 is forbidden before review. No full application rollback service was introduced; engine replacement rollback and legacy data protection are covered.

## Validation completed before commit

| Check | Result |
|---|---|
| Full suite before the final range test | 64 passed, 0 failed |
| Full suite including the range test | 65 passed, 0 failed, 0 skipped; 227,482 ms |
| Unit command | 30 existing + 9 hardening tests passed, no skips |
| Integration command | 56 passed, 0 failed, no skips |
| TypeScript / ESLint / version verification | Passed |
| Build / baseline checks | Real NSIS candidate generated; four engine executables hash/version validated |
| Packaged offline smoke | Two successful runs; corruption of a mutable FFmpeg override repaired offline on restart |
| Native packaged SQLite | WAL/write/read/restart restore and unpacked Node-API module passed |
| Packaged media lifecycle | Video x10, audio x20, Visual Trim x20; streams/FFmpeg/probes/sessions all zero afterward |
| Direct and FFmpeg fixtures | Real analysis, HTTP download, generated playable media, token rejection and ranges passed |
| Actual installed executable | Earlier two-run installed smoke passed; final committed installer will be installed and rechecked separately |
| Real NSIS legacy upgrade | Verified official 2.1.0 installer, upgraded to candidate; every synthetic data file hash preserved and old database readable |
| Production dependency audit | 0 known vulnerabilities |
| Whole dependency audit | 17 development-tool findings: 8 moderate, 9 high; not silently dismissed |
| Whitespace check | git diff --check passed |

Tests retained DirectEngine, DownloadManager, progressive analysis, codecs, pause/resume/cancel/finalization, HLS fixtures, SQLite recovery, trim fallback/failure and media resource cleanup protections. DownloadManager was not rewritten. No unrelated UI redesign or intended removal of playlist/comments/subtitle/tray/download functionality occurred. Passing fixture tests does not establish provider behavior for all live URLs.

Measured startup (one compiled-development runtime versus packaged sample, external fetch disabled): development UI 1,308 ms / runtime ready 7,107 ms; packaged UI 585 ms / runtime ready 5,040 ms. This excludes Vite compilation/server startup and is not a statistical performance benchmark. Packaged smoke total durations include download/playback/stress work and are not startup timings.

Verified 2.1.0 installer: 88,456,198 bytes, SHA-256 `5893c49897417cd0f77bd7396fdf48364a178bfbeac1af2755cdd7f546175d5e`. Current uncommitted 2.1.5 candidate: 271,775,918 bytes. The increase primarily buys offline engine availability. Final committed-build size/hash will be recorded in `app/release/2.1.5/VALIDATION-RESULTS.md`.

## Release blockers and incomplete manual matrix

1. The bundled BtbN FFmpeg is GPL, with linked-library obligations. Engine licenses, npm dependency notices, Electron and Chromium notices are shipped; project MIT does not cover third-party binaries. Exact corresponding FFmpeg/linked-library source and build scripts must be supplied and reviewed. license-compliance.json is intentionally unapproved; CI's public-release gate fails until that review and archive hash are supplied. Merely including a license text does not resolve this obligation.
2. The build is unsigned (Authenticode NotSigned). No signing credentials are available; SmartScreen reputation/identity limitations remain.
3. Live YouTube 360p/720p/1080p/4K, real authenticated/provider errors, thumbnail latency, live playlists/comments/subtitles and provider HLS are not exhaustively manually tested. Offline codec/HLS/cancellation/trim fixtures and renderer lifecycle coverage are not presented as substitutes for that live matrix.
4. Spaces and Arabic characters in installation/userData paths were tested. An actual non-English Windows account, default installation path, very long paths, other GPUs, 4K playback, and an independently verified non-admin token were not tested. No elevation requirement is configured for normal per-user use, but execution under an approved tool host is not proof of every Windows permission environment.
5. Offline smoke rejects external application fetches and preserves loopback fixtures; it is not a physical network disconnection or an OS-wide firewall test covering every subprocess.
6. Analysis/download latency, thumbnail first display, CPU and video RSS comparisons remain unmeasured. Resource handles return to zero, but no claim of statistically bounded RSS across GPUs is made.
7. The production-release GitHub environment must have required reviewers configured in repository settings. This local pass did not execute GitHub Actions, create a tag/release, or test remote publication. Strict tag validation intentionally cannot succeed without the user-reviewed tag.
8. Development-tool audit findings remain. Fixing them requires a separate tested tooling upgrade rather than forcing incompatible npm majors into this runtime pass.

After committing, rebuild from clean source, validate the resulting manifest/artifact metadata, and rerun the actual committed packaged/installed candidate. The ignored validation supplement will record that exact commit, installer hash/size and final results without modifying the source used for the build.

## Exact files changed

The final inventory includes this report:

- .github/workflows/validation.yml
- .gitignore
- app/Back-End/electron/bootstrap.ts
- app/Back-End/electron/diagnostics.ts
- app/Back-End/electron/engineIntegrity.ts
- app/Back-End/electron/ipc/handlers.ts
- app/Back-End/electron/ipcSecurity.ts
- app/Back-End/electron/main.ts
- app/Back-End/electron/mediaRange.ts
- app/Back-End/electron/packagedSmoke.ts
- app/Back-End/electron/paths.ts
- app/Back-End/electron/preload.ts
- app/Back-End/electron/setup.ts
- app/Back-End/electron/ytdlp.ts
- app/build/installer.nsh
- app/electron-builder.json5
- app/engines.lock.json
- app/Front-End/src/App.tsx
- app/Front-End/src/components/MediaPlayer/MediaPlayerModal.tsx
- app/Front-End/src/components/SettingsTab.tsx
- app/Front-End/src/components/SetupOverlay.tsx
- app/Front-End/src/hooks/useSettingsInit.ts
- app/Front-End/src/translations.ts
- app/Front-End/src/vite-env.d.ts
- app/license-compliance.json
- app/package-lock.json
- app/package.json
- app/scripts/build-manifest.cjs
- app/scripts/installer-upgrade.cjs
- app/scripts/license-gate.cjs
- app/scripts/packaged-smoke.cjs
- app/scripts/stage-engines.cjs
- app/scripts/stage-legacy.cjs
- app/scripts/startup-benchmark.cjs
- app/scripts/third-party-notices.cjs
- app/scripts/verify-release.cjs
- app/Shared/types.ts
- app/tests/coreV2.test.cjs
- app/tests/productionHardening.test.cjs
- app/tests/reliability.test.cjs
- app/tests/trimPreview.test.cjs
- app/THIRD-PARTY-NOTICES.txt
- app/tsconfig.json
- app/vite.config.ts
- PRODUCTION-HARDENING-REPORT.md

