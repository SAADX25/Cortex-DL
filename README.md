<div align="center">

  <img src="assets/logo.png" alt="Cortex-DL Logo" width="160" style="border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);" />

  # ⚡ Cortex-DL

  ### *Next-Generation Desktop Download Manager for Windows*

  [![Release](https://img.shields.io/badge/Release-v1.7.0-blue.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/SAADX25/Cortex-DL/releases)
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

  It offers seamless media link analysis, multi-threaded downloading, custom format selection, FFmpeg post-processing, and queue state persistence across sessions. The Windows build comes pre-packaged with all required command-line binaries out of the box.

  [✨ Key Features](#1-features) • [📂 Directory Structure](#2-directory-structure) • [💻 Requirements](#3-requirements) • [🚀 Quick Start](#4-development-setup) • [🛠️ Bundled Tools](#6-bundled-tools) • [🔍 Troubleshooting](#9-troubleshooting)

  ---

</div>

<br />

## 1. Features

- 🎬 **Multi-Source Extraction**: Full URL analysis for 1000+ `yt-dlp`-supported sites, direct HTTP links, and HLS streams.
- 🎨 **Format & Quality Control**: Video resolution selection, audio extraction, container conversion, and precision start/end trimming via FFmpeg.
- ⚡ **High Concurrency & Queue**: Configurable simultaneous downloads (3, 5, or 10 items) powered by a SQLite persistent queue.
- ⏯️ **Full Playback & Queue Controls**: Pause, resume, cancel, retry, delete, pause-all, and resume-all with automatic state recovery.
- 📜 **Playlist & Batch Downloader**: Select specific playlist items or process batch queues of up to 50 items at once.
- 💬 **Subtitles & Comments Export**: Download and embed YouTube subtitles, plus export channel/video comments to structured text files.
- 🎥 **Integrated Media Player**: Native preview for video and audio downloads with subtitle track auto-discovery, playback controls, and stream info overlay.
- 🌐 **Multilingual & System Integration**: Seamless English & Arabic (RTL) interface, system tray minimization, native notifications, and yt-dlp auto-updates.
- 🩺 **Built-in System Health Check**: Real-time diagnostic panel checking `yt-dlp`, `FFmpeg`, `Deno` runtime, cookies, and folder permissions.

---

## 2. Directory Structure

### 📂 Full Project Tree

```text
Cortex DL/
│
├── 📁 .github/                                # GitHub community templates & workflow rules
├── 📁 assets/                                 # Application branding & README assets
│   └── 🖼️ logo.png                            # Official Cortex-DL 3D Logo
├── 📄 .gitignore                              # Git ignore specifications
├── 📄 CODE_OF_CONDUCT.md                      # Community code of conduct
├── 📄 CONTRIBUTING.md                         # Developer contribution guidelines
├── 📄 LICENSE                                 # MIT License terms
├── 📄 README.md                               # Public project documentation
├── 📄 SECURITY.md                             # Security disclosure policy
├── 📄 package-lock.json                       # Root lockfile
├── 📄 package.json                            # Root package configuration
├── ⚙️ Cortex_Dev.bat                           # Windows development helper script
│
└── 📁 app/                                    # Main application package
    ├── 📁 Back-End/                           # Backend services & IPC orchestration
    │   └── 📁 electron/                       # Electron main process source code
    │       ├── 📄 main.ts                     # App entry point, window creation, service bootstrap
    │       ├── 📄 preload.ts                  # Secure contextBridge (window.cortexDl API)
    │       ├── 📄 tray.ts                     # System tray icon and menu management
    │       ├── 📄 downloadManager.ts          # Queue orchestration and concurrent scheduling
    │       ├── 📄 db.ts                       # SQLite setup and prepared statements
    │       ├── 📄 utils.ts                    # Utilities shared across backend modules
    │       ├── 📄 paths.ts                    # Binary and resource path resolution
    │       ├── 📄 ytdlp.ts                    # yt-dlp analysis, updates, and stream URL extraction
    │       ├── 📄 hls.ts                      # HLS playlist and stream variant analysis
    │       ├── 📄 ffmpegEngine.ts             # FFmpeg-based HLS and stream downloader
    │       ├── 📄 progressParser.ts           # yt-dlp and FFmpeg progress parsing
    │       ├── 📄 commentsExtractor.ts        # YouTube comment extraction through yt-dlp
    │       ├── 📄 types.ts                    # Backend types and re-exports
    │       ├── 📄 electron-env.d.ts           # Electron environment declarations
    │       │
    │       ├── 📁 ipc/                        # Inter-process communication
    │       │   └── 📄 handlers.ts             # Central IPC handler registration
    │       │
    │       └── 📁 engines/                    # Download & media processing engines
    │           ├── 📄 IEngine.ts              # Download engine interface
    │           ├── 📄 DirectEngine.ts         # Chunked HTTP downloader
    │           ├── 📄 YoutubeEngine.ts        # yt-dlp process wrapper
    │           ├── 📄 FfmpegEngine.ts         # FFmpeg engine adapter
    │           └── 📄 MediaProcessor.ts       # Media merge, conversion, and FPS inspection
    │
    ├── 📁 Front-End/                          # React user interface
    │   ├── 📄 index.html                      # Main HTML entry point
    │   └── 📁 src/                            # React application source code
    │       ├── 📄 main.tsx                    # React entry point
    │       ├── 📄 App.tsx                     # Root renderer component
    │       ├── 📄 App.css                     # Global styles & layout rules
    │       ├── 📄 translations.ts             # Arabic and English UI strings
    │       ├── 📄 vite-env.d.ts               # Vite and Electron renderer declarations
    │       │
    │       ├── 📁 components/                 # UI components & modular views
    │       │   ├── 📄 AddDownloadTab.tsx      # URL input, analysis, and format selection
    │       │   ├── 📁 AddDownloadTab/
    │       │   │   ├── 📄 UrlAnalysisView.tsx # Analysis results and format selection
    │       │   │   ├── 📄 PlaylistView.tsx    # Playlist item selection
    │       │   │   └── 📄 BatchListView.tsx   # Batch queue preview
    │       │   ├── 📄 DownloadList.tsx       # Download queue list
    │       │   ├── 📄 DownloadCard.tsx       # Individual download UI
    │       │   ├── 📄 DownloadCard.css       # Download card styles
    │       │   ├── 📄 SettingsTab.tsx        # Application settings
    │       │   ├── 📄 Sidebar.tsx            # Navigation sidebar
    │       │   ├── 📄 AdvancedTrimmer.tsx    # Start and end trim controls
    │       │   ├── 📄 AdvancedTrimmer.css    # Trimmer styles
    │       │   ├── 📄 AnimatedSegmentedControl.tsx
    │       │   ├── 📄 CustomDropdown.tsx
    │       │   ├── 📄 SimpleDownloader.tsx    # Quick-download mode
    │       │   ├── 📄 SmartImage.tsx          # Smart thumbnail loader & fallbacks
    │       │   ├── 📄 ConfirmModal.tsx       # Confirmation dialog
    │       │   └── 📁 MediaPlayer/            # Integrated media player
    │       │       ├── 📄 MediaPlayerModal.tsx# Media player modal
    │       │       ├── 📄 MediaPlayer.css     # Media player styles
    │       │       ├── 📄 VideoPlayerView.tsx # Video playback view
    │       │       ├── 📄 AudioPlayerView.tsx # Audio playback view
    │       │       ├── 📄 PlayerControls.tsx  # Playback controls
    │       │       └── 📄 MediaInfoOverlay.tsx# File metadata overlay
    │       │
    │       ├── 📁 hooks/                      # Custom React hooks
    │       │   ├── 📄 types.ts                # Hook-level types
    │       │   ├── 📄 useDownloadController.ts# Download workflow
    │       │   ├── 📄 useHighFrequencyIPC.ts  # Throttled IPC and store updates
    │       │   ├── 📄 useDownloadCardVM.ts    # Download card view model
    │       │   ├── 📄 useAppController.ts     # App-level coordination
    │       │   ├── 📄 useSettingsController.ts# Settings and folder selection
    │       │   ├── 📄 useCommentsController.ts# Comment export workflow
    │       │   └── 📄 useDebounce.ts          # Debounce utility
    │       │
    │       ├── 📁 stores/                     # Global state management (Zustand)
    │       │   ├── 📄 downloadStore.ts        # Zustand download state
    │       │   └── 📄 useUIStore.ts           # Zustand UI state
    │       │
    │       └── 📁 constants/                  # Configuration & constants
    │           └── 📄 formats.ts              # Supported output formats
    │
    ├── 📁 Shared/                             # Shared type definitions
    │   └── 📄 types.ts                        # Types shared by backend and frontend
    │
    ├── 📁 bin/                                # Bundled command-line executables
    │   ├── ⚡ yt-dlp.exe                      # Media extraction and download engine
    │   ├── ⚡ ffmpeg.exe                      # Media processing and HLS engine
    │   ├── ⚡ ffprobe.exe                     # Media stream inspection tool
    │   └── ⚡ deno.exe                        # JS runtime for yt-dlp workflows
    │
    ├── 📁 scripts/                            # Build verification and post-processing scripts
    │   ├── 📄 ensure-electron.cjs             # Verifies Electron binary integrity
    │   └── 📄 strip-comments.cjs              # Build script for code stripping
    │
    ├── 📁 build/                              # Packaging assets & icons
    ├── 📁 release/                            # Packaged installer output
    ├── 📄 .env.example                        # Environment variable template
    ├── 📄 .eslintrc.cjs                       # ESLint configuration
    ├── 📄 vite.config.ts                      # Vite and Electron build configuration
    ├── 📄 tsconfig.json                       # Root TypeScript configuration
    ├── 📄 tsconfig.node.json                  # Node and Electron TypeScript config
    ├── 📄 electron-builder.json5              # Packaging and installer configuration
    └── 📄 package.json                        # App dependencies and scripts
```

---

## 3. Requirements

For local development and building from source:

- **OS**: Windows x64 *(current development scripts and bundled binaries target Windows)*.
- **Node.js**: Modern LTS release (v18+ recommended) & `npm`.
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

### ⚡ Development Helper Script (Windows)

Windows developers can also start the development environment directly from the repository root:

```powershell
.\Cortex_Dev.bat
```

To execute code linting separately:

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
app/release/1.7.0/Cortex DL Setup 1.7.0.exe
```

---

## 6. Bundled Tools

The following executables are maintained under `app/bin/` and automatically embedded into `resources/bin/` during packaging:

| Tool | Status | Description & Role |
| :--- | :---: | :--- |
| `yt-dlp.exe` | `Active` | Core media extraction, URL parsing, and stream downloading engine. |
| `ffmpeg.exe` | `Active` | Handles HLS stream capture, video/audio merging, format conversion, and trimming. |
| `ffprobe.exe` | `Active` | Inspects media file properties, streams, and embedded subtitle tracks. |
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

## 8. Privacy & Local Data Security

Cortex-DL is built with a **privacy-first** architecture:

- 💾 **Local Database**: All download tasks, history, and status payloads are stored in `tasks.sqlite` within Electron's local app-data folder.
- 🔐 **Encrypted Credentials**: User authentication credentials are encrypted using Electron's native `safeStorage` API prior to storage.
- 🌐 **Isolated Media Server**: The built-in media streaming server binds strictly to `127.0.0.1` and enforces strict CORS and path verification.
- 🛡️ **Sandbox Security**: Renderer windows run with `contextIsolation` enabled, Node integration disabled, and explicit `preload` API bridges.

---

## 9. Troubleshooting

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

## 10. Release Notes - v1.7.0

- 🎨 **Visual Redesign**: Sleek UI overhaul with modern component layout, micro-interactions, and visual polish.
- 🖼️ **Smart Thumbnail Rendering**: Integrated `SmartImage` component for robust thumbnail caching and fallback handling.
- ⚡ **Optimized Queue Engine**: Enhanced concurrent task scheduling, rate limiting, and IPC progress throttling.
- 📜 **Open-Source Compliance**: Added MIT License, Contributing Guide, Code of Conduct, Security Policy, and GitHub Issue Templates.

---

<div align="center">

Made with ❤️ by [SAADX25](https://github.com/SAADX25)

</div>