<div align="center">

  <img src="assets/logo.png" alt="Cortex-DL Logo" width="160" style="border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);" />

  # ⚡ Cortex-DL

  [![Release](https://img.shields.io/badge/Release-v2.0.0-blue.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/SAADX25/Cortex-DL/releases)
  [![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/SAADX25/Cortex-DL)
  [![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

  <br />

  ### 🛠️ Built With

  [![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://electronjs.org/)
  [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
  [![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
  
  [![yt-dlp](https://img.shields.io/badge/yt--dlp-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://github.com/yt-dlp/yt-dlp)
  [![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
  [![Deno](https://img.shields.io/badge/Deno-000000?style=for-the-badge&logo=deno&logoColor=white)](https://deno.land/)

  <br />

  **Cortex-DL** is an ultra-fast, feature-packed desktop download manager built with **Electron, React, TypeScript, yt-dlp, FFmpeg, and SQLite**.

  It delivers seamless media link analysis, multi-threaded downloading, custom format selection, FFmpeg post-processing, an integrated zero-leak media player, and queue state persistence across sessions. The Windows build comes pre-packaged with all required command-line binaries out of the box.

  ---

</div>

<br />

## 1. Features

- 🎬 **Multi-Source Extraction**: Full URL analysis for 1000+ `yt-dlp`-supported sites, direct HTTP/HTTPS links, and HLS/m3u8 streams.
- 🚀 **High-Speed Chunked Direct Downloader**: Multi-segmented HTTP download engine with byte-range acceleration, fallback handling, and chunk state preservation across pause/resume cycles.
- 🎨 **Format & Quality Control**: Video resolution selection (up to 4K/8K, 60fps), audio extraction (MP3, WAV, M4A, AAC, FLAC, OGG, OPUS, WMA), container conversion, and precision start/end trimming via FFmpeg.
- ⚡ **High Concurrency & Persistent Queue**: Configurable simultaneous downloads (3, 5, or 10 items) powered by a crash-resilient SQLite database with monotonic progress tracking.
- ⏯️ **Full Playback & Queue Controls**: Pause, resume, cancel, retry, delete (with or without output files), pause-all, and resume-all with automatic state recovery across sessions.
- 📜 **Playlist & Batch Downloader**: Select specific playlist items with thumbnail previews or process batch queues of up to 50 items simultaneously.
- 💬 **Subtitles & Comments Export**: Download and embed multi-language YouTube subtitles, plus export channel and video comments to structured text files.
- 🎥 **Integrated In-App Media Player**: Native preview for video and audio downloads with subtitle auto-discovery, track switching, audio visualizer, ambient lighting, and stream metadata overlay.
- 🛡️ **Zero-Leak Streaming Architecture**: Embedded local HTTP media server with session tracking, probe/FFmpeg process auto-reaping, and Web Audio context release.
- 🌐 **Multilingual & System Integration**: Seamless English & Arabic (RTL) interface, system tray minimization, native notifications, and automatic yt-dlp engine updates.
- 🩺 **Built-in System Health Check & Setup**: Real-time diagnostic panel and startup overlay verifying `yt-dlp`, `FFmpeg`, `ffprobe`, `Deno` runtime, cookies, and folder permissions.

---

## 2. Directory Structure

### 📂 Full Project Tree

```text
Cortex DL/
│
├── 📁 .github/                                # GitHub configuration & issue templates
│   ├── 📁 ISSUE_TEMPLATE/                     # Community issue forms
│   │   ├── 📄 bug_report.md                   # Bug reporting template
│   │   └── 📄 feature-request.md              # Feature suggestion template
│   ├── 📄 FUNDING.yml                         # Project funding & sponsorship configuration
│   └── 📄 PULL_REQUEST_TEMPLATE.md            # Pull request submission guidelines
│
├── 📁 assets/                                 # Application branding & README visual assets
│   └── 🖼️ logo.png                            # Official Cortex-DL 3D high-resolution logo
│
├── 📄 .gitignore                              # Git ignore specifications
├── 📄 CODE_OF_CONDUCT.md                      # Contributor Covenant Code of Conduct
├── 📄 CONTRIBUTING.md                         # Contribution workflow & developer setup guide
├── 📄 LICENSE                                 # MIT Open Source License
├── 📄 package-lock.json                       # Workspace root lockfile
├── 📄 package.json                            # Workspace root package manifest
├── 📄 README.md                               # Comprehensive project documentation
├── 📄 SECURITY.md                             # Security disclosure policy & supported versions
│
└── 📁 app/                                    # Core application source and packaging root
    │
    ├── 📁 Back-End/                           # Electron main process & Node.js backend services
    │   └── 📁 electron/                       # Electron orchestration modules
    │       ├── 📁 engines/                    # Media download & conversion execution engines
    │       │   ├── 📄 DirectEngine.ts         # Multi-chunk HTTP downloader with byte-range resume
    │       │   ├── 📄 FfmpegEngine.ts         # FFmpeg HLS stream capture & transcode engine
    │       │   ├── 📄 IEngine.ts              # Common download engine contract interface
    │       │   ├── 📄 MediaProcessor.ts       # FFmpeg post-processing, stream muxing & FPS inspection
    │       │   └── 📄 YoutubeEngine.ts        # yt-dlp process manager with live progress extraction
    │       │
    │       ├── 📁 ipc/                        # Inter-Process Communication handlers
    │       │   └── 📄 handlers.ts             # IPC registry bridging renderer events to backend logic
    │       │
    │       ├── 📄 audioFormats.ts             # Audio format specifications, containers & FFmpeg presets
    │       ├── 📄 commentsExtractor.ts        # YouTube comment extraction pipeline via yt-dlp
    │       ├── 📄 db.ts                       # SQLite database initialization, schema & prepared statements
    │       ├── 📄 downloadManager.ts          # Queue scheduling, concurrency control & lifecycle management
    │       ├── 📄 electron-env.d.ts           # Main process environment & typing declarations
    │       ├── 📄 ffmpegEngine.ts             # Legacy FFmpeg download routine adapter
    │       ├── 📄 hls.ts                      # HLS stream analysis & m3u8 playlist variant parser
    │       ├── 📄 main.ts                     # Application bootstrap, single-instance lock & window creation
    │       ├── 📄 mediaFiles.ts               # Local HTTP streaming server, token auth & file system security
    │       ├── 📄 mediaRequestRegistry.ts     # Active stream session registry & FFmpeg process leak prevention
    │       ├── 📄 paths.ts                    # Dynamic path resolution for binaries, app data & resources
    │       ├── 📄 preload.ts                  # Secure context isolation bridge (window.cortexDl)
    │       ├── 📄 progressParser.ts           # yt-dlp, FFmpeg & direct download progress parser
    │       ├── 📄 setup.ts                    # Startup dependency verification & environment setup
    │       ├── 📄 tray.ts                     # Windows system tray menu, icon & background minimization
    │       ├── 📄 types.ts                    # Backend-specific types, event payloads & re-exports
    │       ├── 📄 utils.ts                    # Cross-cutting utility functions and file helpers
    │       └── 📄 ytdlp.ts                    # yt-dlp extraction, format discovery & binary updater
    │
    ├── 📁 bin/                                # Bundled standalone binaries (Windows x64)
    │   ├── ⚡ deno.exe                        # High-performance JS runtime for yt-dlp extractor scripts
    │   ├── ⚡ ffmpeg.exe                      # FFmpeg multimedia processor & HLS downloader
    │   ├── ⚡ ffprobe.exe                     # Stream analyzer & codec inspection utility
    │   └── ⚡ yt-dlp.exe                      # YouTube & multi-platform video extraction engine
    │
    ├── 📁 build/                              # Packaging & installer assets
    │   └── 📄 installer.nsh                   # Custom NSIS installer script & Windows registry integration
    │
    ├── 📁 docs/                               # Developer reference & architecture documentation
    │   └── 📄 media-player-diagnostics.md     # Streaming session lifecycle & memory leak diagnostic guide
    │
    ├── 📁 Front-End/                          # Modern React 18 single-page application
    │   ├── 📁 public/                         # Static renderer assets
    │   │   └── 🖼️ CortexDL.ico                # Application desktop & window icon
    │   │
    │   ├── 📁 src/                            # React application source code
    │   │   ├── 📁 actions/                    # Centralized user action dispatchers
    │   │   │   └── 📄 downloadActions.ts      # Queue mutation, pause, resume, cancel & retry actions
    │   │   │
    │   │   ├── 📁 components/                 # UI components & modular views
    │   │   │   ├── 📁 AddDownloadTab/         # Download creation tab sub-views
    │   │   │   │   ├── 📄 BatchListView.tsx   # Bulk URL list parser, validator & batch preview
    │   │   │   │   ├── 📄 PlaylistView.tsx    # YouTube playlist inspector with multi-item selection
    │   │   │   │   └── 📄 UrlAnalysisView.tsx # Stream resolution, codec selection & audio quality controls
    │   │   │   │
    │   │   │   ├── 📁 icons/                  # Custom application SVG icons
    │   │   │   │   └── 📄 YouTubeMusicIcon.tsx# YouTube Music branded SVG component
    │   │   │   │
    │   │   │   ├── 📁 MediaPlayer/            # In-app media player suite
    │   │   │   │   ├── 📄 AudioPlayerView.tsx # Audio playback view with waveform visualization & cover art
    │   │   │   │   ├── 📄 mediaDiagnostics.ts # DevTools runtime memory & stream diagnostic helpers
    │   │   │   │   ├── 📄 MediaInfoOverlay.tsx# Codec, bitrate, FPS & stream metadata inspection overlay
    │   │   │   │   ├── 📄 MediaPlayer.css     # Media player animations, backdrop blur & controls styling
    │   │   │   │   ├── 📄 MediaPlayerModal.tsx# Floating modal host for video & audio playback
    │   │   │   │   ├── 📄 mediaSession.ts     # OS MediaSession API integration & Web Audio context cleanup
    │   │   │   │   ├── 📄 PlayerControls.tsx  # Scrub bar, playback speed, volume & subtitle selectors
    │   │   │   │   └── 📄 VideoPlayerView.tsx # Video playback canvas with subtitle auto-loading
    │   │   │   │
    │   │   │   ├── 📄 AddDownloadTab.tsx      # Main download creation tab container
    │   │   │   ├── 📄 AdvancedTrimmer.css     # Trimmer slider & timestamp editor styling
    │   │   │   ├── 📄 AdvancedTrimmer.tsx     # Precision start/end video trimming component
    │   │   │   ├── 📄 AnimatedSegmentedControl.tsx # Fluid animated tab & option picker
    │   │   │   ├── 📄 ConfirmModal.tsx        # Destructive action & deletion confirmation dialog
    │   │   │   ├── 📄 CustomDropdown.tsx      # Accessible custom dropdown with keyboard navigation
    │   │   │   ├── 📄 DownloadCard.css        # Download card glassmorphism & progress bar styles
    │   │   │   ├── 📄 DownloadCard.tsx        # Live download task card (speeds, ETA, progress, controls)
    │   │   │   ├── 📄 DownloadList.tsx        # Filterable, searchable queue list with batch actions
    │   │   │   ├── 📄 SettingsTab.tsx         # User preferences, cookie manager & system health check
    │   │   │   ├── 📄 SetupOverlay.tsx        # First-launch binary verification & setup modal
    │   │   │   ├── 📄 Sidebar.tsx             # Modern navigation sidebar with live queue badges
    │   │   │   ├── 📄 SimpleDownloader.tsx    # Fast 1-click download view for quick downloads
    │   │   │   ├── 📄 SmartImage.tsx          # Resilient thumbnail loader with fallback placeholders
    │   │   │   └── 📄 UrlInputBar.tsx         # Modern input bar with paste detection, clear & submit
    │   │   │
    │   │   ├── 📁 constants/                  # Application constants & limits
    │   │   │   ├── 📄 formats.ts              # Supported audio/video formats, extensions & MIME mappings
    │   │   │   └── 📄 limits.ts               # Concurrency limits, max batch items & network timeouts
    │   │   │
    │   │   ├── 📁 hooks/                      # Custom React hooks
    │   │   │   ├── 📄 types.ts                # Hook interface & view-model contract definitions
    │   │   │   ├── 📄 useDebounce.ts          # Input debouncing hook for search and URL inputs
    │   │   │   ├── 📄 useDownloadCardVM.ts    # Download card view-model calculations & status formatting
    │   │   │   ├── 📄 useDownloadInit.ts      # Queue hydration, IPC event subscribers & session restore
    │   │   │   ├── 📄 useHighFrequencyIPC.ts  # Throttled IPC event handler for 60 FPS UI updates
    │   │   │   └── 📄 useSettingsInit.ts      # Settings store synchronization & directory persistence
    │   │   │
    │   │   ├── 📁 lib/                        # Renderer utility libraries
    │   │   │   ├── 📄 downloadHelpers.ts      # Download item converters, filename cleaners & format validators
    │   │   │   ├── 📄 mediaEndpoint.ts        # Local streaming server URL & token generator
    │   │   │   └── 📄 variantLabel.ts         # Video resolution & audio quality formatting helpers
    │   │   │
    │   │   ├── 📁 stores/                     # Zustand reactive state stores
    │   │   │   ├── 📄 downloadStore.ts        # Active queue, task history, and throughput metrics store
    │   │   │   ├── 📄 useCommentsStore.ts     # YouTube comment extraction job status & output store
    │   │   │   ├── 📄 useFormStore.ts         # Download configuration, format choice & trimming form store
    │   │   │   ├── 📄 useSettingsStore.ts     # User preferences, thread limits, cookies & binary status store
    │   │   │   └── 📄 useUIStore.ts           # Active navigation tab, language, theme & modal states store
    │   │   │
    │   │   ├── 📄 App.css                     # Global styles, typography, scrollbars & color tokens
    │   │   ├── 📄 App.tsx                     # Main application layout, view switcher & modal host
    │   │   ├── 📄 main.tsx                    # React DOM root mounting & bootstrap
    │   │   ├── 📄 translations.ts             # Comprehensive English & Arabic (RTL) localization strings
    │   │   └── 📄 vite-env.d.ts               # Vite client environment & custom window interface types
    │   │
    │   └── 📄 index.html                      # HTML entry point with font preloads & meta tags
    │
    ├── 📁 scripts/                            # Build verification and maintenance scripts
    │   ├── 📄 ensure-electron.cjs             # Electron binary integrity verification script
    │   └── 📄 strip-comments.cjs              # Production build comment stripping script
    │
    ├── 📁 Shared/                             # Cross-process shared TypeScript modules
    │   ├── 📄 progressModel.ts                # Monotonic progress calculations, speed averaging & ETA smoothing
    │   └── 📄 types.ts                        # Shared data models, IPC contracts, formats & download task types
    │
    ├── 📁 tests/                              # Automated test suite (Node.js test runner)
    │   ├── 📄 mediaLifecycle.test.cjs         # Media player session release, canvas buffer & process cleanup tests
    │   ├── 📄 register-ts.cjs                 # TypeScript compilation hook for native test execution
    │   └── 📄 reliability.test.cjs            # End-to-end tests for DirectEngine, FFmpeg, yt-dlp & SQLite persistence
    │
    ├── 📄 .env                                # Local environment variables
    ├── 📄 .env.example                        # Environment variable blueprint
    ├── 📄 .eslintrc.cjs                       # ESLint static code analysis rules
    ├── 📄 electron-builder.json5              # electron-builder packaging, NSIS & compression configuration
    ├── 📄 package-lock.json                   # Application dependencies lockfile
    ├── 📄 package.json                        # App dependencies, metadata & build scripts
    ├── 📄 tsconfig.json                       # Base TypeScript configuration
    ├── 📄 tsconfig.node.json                  # Node.js process TypeScript configuration
    └── 📄 vite.config.ts                      # Vite build pipeline & Electron plugin integration
```

---

## 3. Requirements

For local development and building from source:

- **OS**: Windows x64 *(current development scripts and bundled binaries target Windows)*.
- **Node.js**: Modern LTS release (v18+ or v20+ recommended) & `npm`.
- **Git**: For repository cloning and version control.
- **Network**: Internet connection for dependency installation, engine updates, and media downloading.

> [!NOTE]
> All core execution binaries (`yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`, `deno.exe`) are pre-bundled in `app/bin/`. No additional manual installations are required for end users.

---

## 4. Development Setup

Clone the repository, navigate to the application package, install dependencies, and launch the Vite + Electron development environment:

```powershell
# Clone the repository
git clone https://github.com/SAADX25/Cortex-DL.git

# Enter application directory
cd Cortex-DL\app

# Install dependencies
npm ci

# Launch development app
npm run dev
```

### 🧪 Automated Testing

Execute the comprehensive Node.js test suite covering multi-chunk downloads, FFmpeg conversion pipelines, yt-dlp extraction, and media player streaming lifecycle:

```powershell
cd app
npm test
```

### 🔍 Code Linting

To execute static code analysis and linting:

```powershell
cd app
npm run lint
```

---

## 5. Build for Windows

To build a standalone production installer for Windows x64:

```powershell
cd app
npm ci
npm run build
```

The build pipeline performs TypeScript verification, bundles Vite and Electron resources, and generates an NSIS installer under:

```text
app/release/2.0.0/Cortex DL Setup 2.0.0.exe
```

---

## 6. Bundled Tools

The following executables are maintained under `app/bin/` and automatically embedded into `resources/bin/` during packaging:

| Tool | Status | Description & Role |
| :--- | :---: | :--- |
| `yt-dlp.exe` | `Active` | Core media extraction, URL parsing, and stream downloading engine. |
| `ffmpeg.exe` | `Active` | Handles HLS stream capture, video/audio merging, format conversion, and trimming. |
| `ffprobe.exe` | `Active` | Inspects media file properties, streams, codecs, and embedded subtitle tracks. |
| `deno.exe` | `Active` | Modern JavaScript runtime required for advanced `yt-dlp` extractor scripts. |

---

## 7. YouTube & Cookie Management

> [!IMPORTANT]
> Access to media on YouTube and restricted platforms may vary based on account status, region, age restrictions, or CAPTCHA challenges.

Cortex-DL supports configuring a Netscape-format `cookies.txt` file in **Settings**:
- The uploaded file undergoes automatic format validation before use.
- Cookies allow access to authenticated streams but must be kept secure. Do not share your cookie file.
- Cortex-DL operates within platform access rules and does not bypass DRM restrictions.

---

## 8. Media Player Diagnostics & Lifecycle

Cortex-DL v2.0.0 features a dedicated media player lifecycle management system designed to eliminate memory leaks, orphaned FFmpeg processes, and hanging streams.

Developers can inspect live player metrics directly from the DevTools console:

```javascript
await window.__cortexMediaDiagnostics()
```

Refer to [`docs/media-player-diagnostics.md`](app/docs/media-player-diagnostics.md) for full benchmarking workflows and leak verification procedures.

---

## 9. Privacy & Local Data Security

Cortex-DL is built with a **privacy-first** architecture:

- 💾 **Local Database**: All download tasks, history, and status payloads are stored in `tasks.sqlite` within Electron's local app-data folder.
- 🔐 **Encrypted Credentials**: User authentication credentials are encrypted using Electron's native `safeStorage` API prior to storage.
- 🌐 **Isolated Media Server**: The built-in media streaming server binds strictly to `127.0.0.1` and enforces strict CORS, token authentication, and path verification.
- 🛡️ **Sandbox Security**: Renderer windows run with `contextIsolation` enabled, Node integration disabled, and explicit `preload` API bridges.

---

## 10. Troubleshooting

> [!TIP]
> Use the **Health Check** panel in application Settings to quickly verify binary status and folder permissions.

<details>
<summary><b>YouTube requests sign-in or CAPTCHA</b></summary>
<br />

Export fresh Netscape-format cookies using a browser extension (e.g. *Get cookies.txt LOCALLY*) and load the file into **Cortex-DL Settings**.
</details>

<details>
<summary><b>Missing FFmpeg or yt-dlp binary error</b></summary>
<br />

Verify that `app/bin/` contains all 4 executable files (`yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`, `deno.exe`). Antivirus software may occasionally quarantine executables.
</details>

<details>
<summary><b>Windows SmartScreen Warning</b></summary>
<br />

Click **More Info** -> **Run Anyway**. The installer is unsigned as it is an open-source development release.
</details>

<details>
<summary><b>App window hides on close</b></summary>
<br />

Cortex-DL minimizes to the Windows System Tray by default. Check the tray icon in the taskbar to reopen or quit the application.
</details>

---

<div align="center">

Made with ❤️ by [SAADX25](https://github.com/SAADX25)

</div>
