<div align="center">
  <img src="assets/logo.png" alt="Cortex DL" width="160" />

# Cortex DL

A modern, high-performance Windows desktop video and audio downloader built with Electron, React, TypeScript, yt-dlp, FFmpeg, and SQLite.

[![Version](https://img.shields.io/badge/version-2.2.0-blue?style=flat-square)](https://github.com/SAADX25/Cortex-DL/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6?style=flat-square&logo=windows)](https://github.com/SAADX25/Cortex-DL/releases)
[![Tests](https://img.shields.io/badge/tests-159%20passed-success?style=flat-square)](#validation)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-24.x-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/electron-44.x-47848F?style=flat-square&logo=electron)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/react-18.x-61DAFB?style=flat-square&logo=react)](https://react.dev)

---

| 📖 [README](README.md) | 🤝 [Code of Conduct](CODE_OF_CONDUCT.md) | 👥 [Contributing](CONTRIBUTING.md) | ⚖️ [MIT License](LICENSE) | 🛡️ [Security](SECURITY.md) | 🚀 [Releases](https://github.com/SAADX25/Cortex-DL/releases) |
| :---: | :---: | :---: | :---: | :---: | :---: |

---

</div>

## Features

- Download from yt-dlp-supported sites, direct HTTP/HTTPS URLs and HLS streams.
- Choose video quality and media format, extract audio, and trim media.
- Queue downloads, process playlists and batches, pause/resume, and control concurrency.
- Keep download history and queue state across restarts using SQLite.
- Play downloaded video and audio inside the app.
- Generate, translate, review and export speech subtitles locally. See [local subtitle setup](LOCAL-SUBTITLES.md).
- Use English or Arabic, notifications, and the system tray.
- Check engine health and repair missing or damaged engines.

## Development

The current development and validation workflows target Windows x64 and Node.js 24. Install Git and Node.js, then run:

```powershell
git clone https://github.com/SAADX25/Cortex-DL.git
cd Cortex-DL\app
npm ci
npm run dev
```

You can also use `Cortex_Dev.bat` in the project root after installing dependencies. Root shortcuts are available: `npm run setup`, `npm run dev`, `npm run check` and `npm run build`. The `app` folder contains the application package and its dependency lockfile.

The development startup stages verified engines in `app/engine-baseline`. Keep that directory for offline development and media integration tests. Its downloaded archives are reused by the staging script.

## Project layout

```text
Cortex-DL/
├── .github/                       # GitHub CI/CD workflows, issue templates & automation
│   ├── workflows/
│   │   └── validation.yml         # Automated Windows validation, test suite & release pipeline
│   └── ISSUE_TEMPLATE/            # Standardized bug report and feature request templates
├── assets/                        # Repository assets and application branding
│   └── logo.png                   # Official high-resolution project logo
├── app/                           # Core desktop application workspace
│   ├── Back-End/                  # Electron main process & native backend subsystems
│   │   └── electron/
│   │       ├── engines/           # Specialized download, processing & streaming engines
│   │       │   ├── YoutubeEngine.ts    # yt-dlp wrapper, format resolver & quality selection
│   │       │   ├── DirectEngine.ts     # Multi-chunk HTTP/HTTPS range downloader
│   │       │   └── MediaProcessor.ts   # FFmpeg audio/video muxing, trimming & transcoding
│   │       ├── ipc/               # Strongly-typed IPC handlers & security validation
│   │       │   └── handlers.ts         # Renderer-to-Main IPC invocation endpoints
│   │       ├── downloadManager.ts # Core queue orchestrator, attempt lifecycle & state machine
│   │       ├── db.ts              # SQLite database layer (tasks, history & user settings)
│   │       ├── engineIntegrity.ts # Engine hashing, SHA-256 verification & binary security
│   │       ├── engineReceipts.ts  # Authoritative startup receipts & instant-migration cache
│   │       ├── engineReadiness.ts # Non-blocking background verification & readiness tracking
│   │       ├── youtubeSubtitles.ts# Subtitle extraction, VTT parsing & soft-sub embedding
│   │       ├── diagnostics.ts     # Health checks, log redaction & diagnostic bundles
│   │       ├── entrypoint.ts      # Early Electron bootstrap & startup benchmark probe
│   │       ├── main.ts            # Electron app lifecycle, window manager & tray integration
│   │       └── preload.ts         # Secure context bridge exposing sanitized APIs to renderer
│   ├── Front-End/                 # Modern React 18 user interface (Vite + Custom CSS)
│   │   ├── public/                # Static assets & application Windows icon (CortexDL.ico)
│   │   └── src/
│   │       ├── components/        # UI components (DownloadList, SettingsTab, SetupOverlay, MediaPlayer)
│   │       ├── stores/            # Zustand state management (downloadStore, useSettingsStore)
│   │       ├── hooks/             # Custom React hooks (useDownloadCardVM, useSettingsInit)
│   │       ├── actions/           # User action dispatchers & download event handlers
│   │       ├── translations.ts    # Comprehensive bilingual localization (Arabic & English)
│   │       ├── App.tsx            # Main application layout, sidebar navigation & modals
│   │       └── main.tsx           # React DOM initialization & theme mounting
│   ├── Shared/                    # Shared TypeScript models, contracts & progress schemas
│   │   ├── types.ts               # Unified TypeScript interfaces between Main and Renderer
│   │   ├── progressModel.ts       # Byte-accurate multi-engine progress calculation
│   │   ├── analysisUrl.ts         # URL detection, protocol sanitization & playlist parsing
│   │   └── youtubeErrors.ts       # Structured error classification & user-friendly messages
│   ├── build/                     # NSIS Windows installer assets & upgrade scripts
│   │   └── installer.nsh          # Custom NSIS script for zero-data-loss upgrade migrations
│   ├── docs/                      # Architectural specifications & release documentation
│   │   ├── downloader-core-v2.md  # State machine, attempt ownership & lifecycle guide
│   │   ├── startup-architecture.md# Instant startup benchmark & receipt verification specs
│   │   ├── analysis-performance.md# URL analysis optimizations & caching mechanisms
│   │   └── development.md         # Developer guide, module map & extension points
│   ├── scripts/                   # Production build, validation & maintenance utilities
│   │   ├── build-manifest.cjs     # Injects git commit, engine hashes & build timestamps
│   │   ├── verify-release.cjs     # Automated release gate verifying tags, versions & hashes
│   │   ├── stage-engines.cjs      # Development engine provisioning & local baseline cache
│   │   └── clean.cjs              # Safe output cleaner preserving configs & partial downloads
│   ├── tests/                     # Automated test suites (Unit, Integration & Packaged smoke)
│   │   ├── coreV2.test.cjs        # Download manager lifecycle, retry backoff & pause/resume tests
│   │   ├── engineReceipts.test.cjs# Instant startup receipt validation & migration tests
│   │   ├── cleanup.test.cjs       # Artifact cleanup & junction traversal protection tests
│   │   └── productionHardening.test.cjs # Release gate, IPC security & argument sanitization
│   ├── electron-builder.json5     # NSIS installer packaging & auto-update specifications
│   ├── engines.lock.json          # Cryptographically pinned engine hashes (yt-dlp, FFmpeg, Deno)
│   ├── package.json               # Desktop application dependencies & script definitions (v2.2.0)
│   └── vite.config.ts             # Vite configuration with embedded Electron compilation
├── Cortex_Dev.bat                 # One-click Windows development launcher script
├── CODE_OF_CONDUCT.md             # Community standards, expected behavior & enforcement
├── CONTRIBUTING.md                # Development guidelines, setup & pull request procedures
├── LICENSE                        # MIT Open-Source License
├── package.json                   # Root monorepo proxy scripts (setup, dev, check, build)
├── README.md                      # Comprehensive project documentation & user manual
└── SECURITY.md                    # Security policy, supported versions & vulnerability reporting
```

Generated build output, downloaded engines, dependencies and test results are ignored by Git. The repository root contains branding, contributor documents and the development launcher.

See [the development guide](app/docs/development.md) for extension points and [Contributing](CONTRIBUTING.md) for the complete setup and validation workflow.

## Validation

Run from `app`:

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm test
```

From the repository root, `npm run check` runs TypeScript, ESLint and the full regression suite together.

Tests that run real media tools require `npm run engines:stage` first. Packaged and installer validation require a fresh Windows build:

```powershell
npm run build
npm run test:packaged
npm run test:installer
```

The isolated uninstall cleanup check is available as `node scripts/test-uninstall-data.cjs <path-to-makensis.exe>`. It uses disposable directories under `app/installer-validation`.

## Build for Windows

```powershell
cd app
npm run build
```

The current installer is `app/release/2.2.0/Cortex-DL-Setup-2.2.0.exe`. The `.blockmap` and `latest.yml` files beside it describe the update artifact. Each production build clears obsolete Electron chunks before packaging.

Release validation is defined in `.github/workflows/validation.yml`. Tagged builds publish the exact installer that passed validation. Public release checks verify versions, artifact hashes, shipped notices and package contents. Builds containing engine binaries also require the source archive review in `app/license-compliance.json`; the current installer downloads engines separately.

## Engines, history and temporary files

The Windows installer downloads and verifies yt-dlp, FFmpeg, ffprobe and Deno on first launch. Later launches check the installed engines and reuse healthy copies. An internet connection is needed for first-run provisioning, repairs, updates and media downloads.

Application data is stored in `%APPDATA%\cortex-dl`:

- `tasks.sqlite` stores download history and settings.
- `bin` stores installed engines and integrity receipts.
- `logs` stores diagnostic logs.

History loads independently of engine verification. A download uses `.cortex_temp/<taskId>/<attemptId>` under its selected destination. Completed and canceled downloads remove their temporary directories; paused or failed downloads retain partial files for retry/resume. Startup retries cleanup for completed and canceled records.

Closing the window normally hides the app in the system tray. Use the tray's exit action to quit completely.

Uninstalling offers a choice to keep or delete application data. Full removal includes engines, settings, cache and history in the current and legacy AppData folders. Downloaded video/audio files are preserved. Normal application updates preserve AppData.

## Cleaning generated files

```powershell
npm run clean:preview
npm run clean
# Optional: also remove unpacked Windows builds
npm run clean:packaged
```

Run these commands from the repository root. Standard cleanup removes `dist-electron`, `Front-End/dist`, generated smoke/installer validation folders, retired local `app/bin`, and generated metadata/configuration output. It preserves source (including `app/build` installer source), tests, installed dependencies, verified development engines, release installers, `.env` and `.cortex_temp` experiments/partial downloads. The cleaner refuses symbolic links and junctions before deleting files. Run it after test/development processes have stopped. The next development run or build recreates required output.

`clean:packaged` also removes `app/release/<version>/win-unpacked`. Build again before packaged tests or release artifact verification. Installer `.exe`, `.blockmap` and `latest.yml` files are retained.

## Troubleshooting and implementation notes

Use **Settings → App readiness** or **Repair Engines** for missing or damaged tools, and **Open Logs** for diagnostics. Public video requests use no sign-in credentials. For restricted content, use a local media file in the subtitle workspace.

Feature and architecture documentation:

- [Downloader lifecycle, ownership and recovery](app/docs/downloader-core-v2.md)
- [Startup architecture and instant engine receipts](app/docs/startup-architecture.md)
- [URL analysis performance & optimizations](app/docs/analysis-performance.md)
- [Media processing & FFmpeg pipeline](app/docs/media-processing-performance.md)
- [Visual Trim preview & media playback](app/docs/visual-trim-preview.md)
- [Media player diagnostics](app/docs/media-player-diagnostics.md)
- [Developer guide & module map](app/docs/development.md)
