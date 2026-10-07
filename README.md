<div align="center">
  <img src="assets/logo.png" alt="Cortex DL" width="160" />

# Cortex DL

A Windows desktop video and audio downloader built with Electron, React, TypeScript, yt-dlp, FFmpeg and SQLite.

[Releases](https://github.com/SAADX25/Cortex-DL/releases) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT License](LICENSE)
</div>

## Features

- Download from yt-dlp-supported sites, direct HTTP/HTTPS URLs and HLS streams.
- Choose video quality and media format, extract audio, and trim media.
- Queue downloads, process playlists and batches, pause/resume, and control concurrency.
- Keep download history and queue state across restarts using SQLite.
- Play downloaded video and audio inside the app.
- Use English or Arabic, optional cookies, notifications, and the system tray.
- Check engine health and repair missing or damaged engines.

## Development

The current development and validation workflows target Windows x64 and Node.js 24. Install Git and Node.js, then run:

```powershell
git clone https://github.com/SAADX25/Cortex-DL.git
cd Cortex-DL\app
npm ci
npm run dev
```

You can also use `Cortex_Dev.bat` in the project root after installing dependencies. The `app` folder contains the npm package; run npm commands there.

The development startup stages verified engines in `app/engine-baseline`. Keep that directory for offline development and media integration tests. Its downloaded archives are reused by the staging script.

## Project layout

```text
app/
  Back-End/electron/   Electron, SQLite, IPC, download engines and media services
  Front-End/src/       React UI, stores, hooks and translations
  Front-End/public/    Application icon
  Shared/             Shared types and progress models
  build/              NSIS installer source
  docs/               Architecture and feature documentation
  scripts/            Build, engine staging and validation tools
  tests/              Regression tests and reusable fixtures
  package.json        Dependencies and npm commands
  engines.lock.json   Pinned engine versions, downloads and checksums
```

Generated build output, downloaded engines, dependencies and test results are ignored by Git. The repository root contains branding, contributor documents and the development launcher.

## Validation

Run from `app`:

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm test
```

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

The current installer is `app/release/2.1.8/Cortex-DL-Setup-2.1.8.exe`. The `.blockmap` and `latest.yml` files beside it describe the update artifact. Each production build clears obsolete Electron chunks before packaging.

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
cd app
npm run clean
```

This removes `dist-electron`, `Front-End/dist`, temporary experiment data, and generated smoke/installer validation folders. It preserves source, tests, installed dependencies, verified development engines and release installers. Run it after test/development processes have stopped. The next development run or build recreates its output.

## Troubleshooting and implementation notes

Use **Settings → Health Check** or **Repair Engines** for missing or damaged tools, and **Open Log Folder** for diagnostics. For content requiring an account, select a valid Netscape-format cookies file in Settings.

Feature and architecture documentation:

- [Downloader lifecycle, ownership and recovery](app/docs/downloader-core-v2.md)
- [URL analysis performance](app/docs/analysis-performance.md)
- [Media processing](app/docs/media-processing-performance.md)
- [Visual Trim preview](app/docs/visual-trim-preview.md)
- [Media player diagnostics](app/docs/media-player-diagnostics.md)
