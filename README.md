# Cortex-DL

**Current release:** v1.7.0

**Platform:** Windows x64

Cortex-DL is a desktop download manager built with Electron, React, TypeScript, yt-dlp, FFmpeg, and SQLite.

It can analyze supported media links, queue downloads, select output formats, process media with FFmpeg, and keep download state between sessions. The Windows build includes the command-line tools it needs, so normal users do not need to install yt-dlp, FFmpeg, ffprobe, or Deno separately.

Use Cortex-DL only for content you are authorized to download. Website terms, copyright rules, and access restrictions still apply.

## 2. Directory Structure

```text
Cortex DL/
├── app/                               # Main application package
│   ├── Back-End/
│   │   └── electron/                  # Electron main process source
│   │       ├── main.ts                # App entry point, window creation, service bootstrap
│   │       ├── preload.ts             # Secure contextBridge (window.cortexDl API)
│   │       ├── tray.ts                # System tray icon and menu management
│   │       ├── downloadManager.ts     # Queue orchestration and concurrent scheduling
│   │       ├── db.ts                  # SQLite setup and prepared statements
│   │       ├── utils.ts               # Utilities shared across backend modules
│   │       ├── paths.ts               # Binary and resource path resolution
│   │       ├── ytdlp.ts               # yt-dlp analysis, updates, and stream URL extraction
│   │       ├── hls.ts                 # HLS playlist and stream variant analysis
│   │       ├── ffmpegEngine.ts        # FFmpeg-based HLS and stream downloader
│   │       ├── progressParser.ts      # yt-dlp and FFmpeg progress parsing
│   │       ├── commentsExtractor.ts   # YouTube comment extraction through yt-dlp
│   │       ├── types.ts               # Backend types and re-exports
│   │       ├── electron-env.d.ts      # Electron environment declarations
│   │       ├── ipc/
│   │       │   └── handlers.ts        # Central IPC handler registration
│   │       └── engines/
│   │           ├── IEngine.ts         # Download engine interface
│   │           ├── DirectEngine.ts    # Chunked HTTP downloader
│   │           ├── YoutubeEngine.ts   # yt-dlp process wrapper
│   │           ├── FfmpegEngine.ts    # FFmpeg engine adapter
│   │           └── MediaProcessor.ts  # Media merge, conversion, and FPS inspection
│   ├── Front-End/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx               # React entry point
│   │       ├── App.tsx                # Root renderer component
│   │       ├── App.css                # Global styles
│   │       ├── translations.ts        # Arabic and English UI strings
│   │       ├── vite-env.d.ts          # Vite and Electron renderer declarations
│   │       ├── components/
│   │       │   ├── AddDownloadTab.tsx         # URL input, analysis, and format selection
│   │       │   ├── AddDownloadTab/
│   │       │   │   ├── UrlAnalysisView.tsx    # Analysis results and format selection
│   │       │   │   ├── PlaylistView.tsx       # Playlist item selection
│   │       │   │   └── BatchListView.tsx      # Batch queue preview
│   │       │   ├── DownloadList.tsx           # Download queue list
│   │       │   ├── DownloadCard.tsx           # Individual download UI
│   │       │   ├── DownloadCard.css           # Download card styles
│   │       │   ├── SettingsTab.tsx            # Application settings
│   │       │   ├── Sidebar.tsx                # Navigation sidebar
│   │       │   ├── AdvancedTrimmer.tsx        # Start and end trim controls
│   │       │   ├── AdvancedTrimmer.css        # Trimmer styles
│   │       │   ├── AnimatedSegmentedControl.tsx
│   │       │   ├── CustomDropdown.tsx
│   │       │   ├── SimpleDownloader.tsx       # Quick-download mode
│   │       │   ├── ConfirmModal.tsx           # Confirmation dialog
│   │       │   └── MediaPlayer/
│   │       │       ├── MediaPlayerModal.tsx   # Media player modal
│   │       │       ├── MediaPlayer.css        # Media player styles
│   │       │       ├── VideoPlayerView.tsx    # Video playback view
│   │       │       ├── AudioPlayerView.tsx    # Audio playback view
│   │       │       ├── PlayerControls.tsx     # Playback controls
│   │       │       └── MediaInfoOverlay.tsx   # File metadata overlay
│   │       ├── hooks/
│   │       │   ├── types.ts                   # Hook-level types
│   │       │   ├── useDownloadController.ts   # Download workflow
│   │       │   ├── useHighFrequencyIPC.ts     # Throttled IPC and store updates
│   │       │   ├── useDownloadCardVM.ts       # Download card view model
│   │       │   ├── useAppController.ts        # App-level coordination
│   │       │   ├── useSettingsController.ts   # Settings and folder selection
│   │       │   ├── useCommentsController.ts   # Comment export workflow
│   │       │   └── useDebounce.ts             # Debounce utility
│   │       ├── stores/
│   │       │   ├── downloadStore.ts           # Zustand download state
│   │       │   └── useUIStore.ts              # Zustand UI state
│   │       └── constants/
│   │           └── formats.ts                 # Supported output formats
│   ├── Shared/
│   │   └── types.ts                   # Types shared by backend and frontend
│   ├── bin/                           # Bundled command-line tools
│   │   ├── yt-dlp.exe                 # Media extraction and download engine
│   │   ├── ffmpeg.exe                 # Media processing tool
│   │   ├── ffprobe.exe                # Media stream inspection tool
│   │   └── deno.exe                   # JavaScript runtime for yt-dlp workflows
│   ├── build/                         # Electron Builder resources
│   ├── release/                       # Generated installer output
│   ├── .env.example                   # Environment variable template
│   ├── vite.config.ts                 # Vite and Electron build configuration
│   ├── tsconfig.json                  # TypeScript configuration
│   ├── tsconfig.node.json             # Node and Electron TypeScript configuration
│   ├── electron-builder.json5         # Packaging and installer configuration
│   └── package.json                   # App dependencies and scripts
├── Cortex_Dev.bat                     # Windows development helper
├── README.md                          # Public project documentation
└── package.json                       # Root package placeholder
```

## Features

- URL analysis for yt-dlp-supported sites, direct HTTP links, and HLS streams.
- Video and audio format selection, with FFmpeg used for merging and conversion where required.
- Quality selection, optional speed limits, and start/end trimming for supported downloads.
- Playlist selection and batch queues of up to 50 items.
- Pause, resume, cancel, retry, delete, pause-all, and resume-all controls.
- Configurable concurrency with 3, 5, or 10 simultaneous downloads.
- Persistent queue and download history stored in SQLite.
- YouTube subtitle selection and embedding when subtitle tracks are available.
- YouTube comment export to a text file.
- Built-in audio and video playback for downloaded files, including local and embedded subtitle discovery.
- English and Arabic interface support, system tray behavior, desktop notifications, application updates, and yt-dlp updates.
- A settings health check for yt-dlp, FFmpeg, the JavaScript runtime, cookies, and download-directory access.

Website support is determined largely by yt-dlp and can change when a platform changes its site or access rules.

## Requirements

For development and local builds:

- Windows x64. The current development helper, packaged binaries, and verified release target are Windows-specific.
- Node.js and npm. The project does not currently pin an exact Node.js version; use a maintained release.
- Git, if you are cloning the repository.
- Network access for dependency installation, update checks, and media access.

The required media tools are already stored in `app/bin/`.

## Development Setup

Clone the repository, enter the application package, install dependencies, and start the Electron/Vite development process:

```powershell
git clone https://github.com/SAADX25/Cortex-DL.git
cd Cortex-DL\app
npm ci
npm run dev
```

From the repository root, Windows developers can also run:

```powershell
.\Cortex_Dev.bat
```

The helper installs dependencies when needed and then runs the development script. To run the linter separately:

```powershell
cd app
npm run lint
```

## Build for Windows

Run the build from the `app` directory:

```powershell
cd app
npm ci
npm run build
```

The build runs TypeScript checks, creates the Vite/Electron bundles, and packages a Windows x64 NSIS installer. Output is written to:

```text
app/release/1.7.0/
```

The configured installer name is `Cortex DL Setup 1.7.0.exe`. The build script clears the existing `app/release/` directory before packaging. `npm run dist` is an alias for the same build.
## Bundled Tools

The following executables are present in `app/bin/` and copied to `resources/bin/` in the packaged Windows application:

| Tool | Purpose |
|---|---|
| `yt-dlp.exe` | Analyzes supported sites and downloads media and metadata. |
| `ffmpeg.exe` | Handles HLS downloads, media merging, conversion, trimming, and subtitle processing. |
| `ffprobe.exe` | Inspects media streams, including embedded subtitle information. |
| `deno.exe` | Provides a JavaScript runtime used by current yt-dlp extraction workflows when required. |

Normal users do not need to install these tools manually. For source development, keep all four files in `app/bin/`; missing files will cause health-check or download failures.

## YouTube / CAPTCHA Notes

YouTube and other platforms may require sign-in, cookies, or additional verification. Access can also vary by account, region, age restrictions, rate limits, and CAPTCHA challenges.

Cortex-DL supports selecting a Netscape-format `cookies.txt` file in Settings. The file must contain valid YouTube cookies to pass the built-in validation. Cookies can expire or be rejected, and supplying them does not guarantee that a blocked link will work.

Cookie files can grant access to an account. Do not share them, and remove the configured file when it is no longer needed. Cortex-DL does not bypass DRM or platform access controls.

## Privacy & Local Data

Cortex-DL keeps application data on the local machine:

- Download tasks and history are stored in `tasks.sqlite` under Electron's application user-data directory. Task records include URLs, filenames, status, progress, and the full task payload.
- Settings such as the download directory, concurrency, and selected cookie-file path are stored locally in SQLite.
- Interface preferences such as language, speed limit, player preference, selected directory, and download statistics are stored in Electron renderer storage.
- Saved username and password settings are encrypted through Electron `safeStorage` before the encrypted values are placed in renderer storage. When credentials are attached to a download task, they can also be present in that task's local SQLite payload.
- The selected `cookies.txt` file is read from its original location; the application stores its path rather than copying the file into the project.
- Downloaded media is written to the directory chosen by the user. Thumbnail cache files may be written to the operating system's temporary directory.
- Local diagnostic logs are produced by `electron-log` and may include task URLs and error details.

Treat the application profile, logs, cookies, and download history as sensitive if you use authenticated downloads.

## Security

The Electron window runs with context isolation and sandboxing enabled, with Node.js integration disabled. Renderer access to desktop functions is exposed through a defined preload API. The local media server binds to `127.0.0.1` and checks request origins, paths, and supported file types. The IPC handler used for external links accepts only HTTP and HTTPS URLs.

These controls reduce common desktop-app risks, but they are not a security guarantee. Cortex-DL launches bundled third-party tools and processes untrusted remote media. Keep the application and yt-dlp current, obtain installers from a source you trust, and be careful with cookie files and account credentials. The project does not claim to have completed a formal security audit.

## Troubleshooting

- **YouTube asks for login or CAPTCHA:** Select a fresh Netscape-format `cookies.txt` file in Settings. Account, region, rate-limit, or CAPTCHA restrictions may still prevent access.
- **FFmpeg or ffprobe is missing:** Confirm the files exist in `app/bin/` during development. For an installed copy, reinstall from a trusted release and check antivirus quarantine.
- **A download fails:** Check that the URL works in a browser, the destination is writable, and the Settings health check passes. Updating yt-dlp may help when a site has changed.
- **Windows SmartScreen warns about the installer:** Verify the download source before choosing **More info > Run anyway**. The project configuration does not define a Windows signing certificate.
- **The app does not appear:** Check the system tray first; Cortex-DL allows one running instance and hides its window when closed.

## Known Limitations

- The current verified release is Windows x64. macOS and Linux targets exist in the builder configuration, but only Windows tool binaries are bundled.
- Website support can break when platforms change their pages, APIs, authentication, or CAPTCHA behavior.
- Private, regional, age-restricted, or account-bound media may require valid cookies and may remain unavailable.
- DRM-protected media is not supported.
- Playlist and batch selection is limited to 50 items per batch.
- Pause and resume behavior depends on the selected engine and the remote server.

## Release Notes - v1.7.0

- Redesigned UI with improved layout, animations, and visual polish across all components.
- Added smart thumbnail support with `SmartImage` component for download cards.
- Improved download queue management and concurrent scheduling logic.
- Updated yt-dlp engine with better error handling and stream extraction reliability.
- Refreshed Sidebar navigation with updated layout and transitions.
- Refined `AdvancedTrimmer`, `ConfirmModal`, and `DownloadCard` styles and behavior.
- Added open-source community files: MIT License, Code of Conduct, Contributing guide, Security policy, and GitHub issue and pull-request templates.
- General code cleanup, dead-code removal, and stability improvements.

## Release Notes - v1.6.0

- Bundled Deno and added JavaScript runtime selection for current yt-dlp workflows.
- Added health checks for yt-dlp, FFmpeg, the JavaScript runtime, cookies, and download-directory access.
- Added YouTube cookie-file validation and clearer login/CAPTCHA errors.
- Refined download progress, queue handling, output processing, settings, and in-app playback.
- Updated Windows packaging to include `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`, and `deno.exe`.
