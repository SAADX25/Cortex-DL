# Cortex DL — Architecture Reference

> **Version:** 1.4.0  
> **Stack:** Electron · React · TypeScript · SQLite · yt-dlp · ffmpeg

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Directory Structure](#2-directory-structure)
3. [Technology Stack](#3-technology-stack)
4. [Architecture Layers](#4-architecture-layers)
5. [Backend — Electron Main Process](#5-backend--electron-main-process)
   - 5.1 [Entry Point — main.ts](#51-entry-point--maints)
   - 5.2 [IPC API Surface](#52-ipc-api-surface)
   - 5.3 [Download Manager](#53-download-manager)
   - 5.4 [Engine System](#54-engine-system)
   - 5.5 [URL Analysis Pipeline](#55-url-analysis-pipeline)
   - 5.6 [Media Streaming Server](#56-media-streaming-server)
   - 5.7 [Database Layer — SQLite](#57-database-layer--sqlite)
   - 5.8 [yt-dlp Module](#58-yt-dlp-module)
   - 5.9 [Comments Extractor](#59-comments-extractor)
   - 5.10 [Paths Module](#510-paths-module)
   - 5.11 [Utils Module](#511-utils-module)
   - 5.12 [Progress Parser](#512-progress-parser)
6. [Preload Bridge — preload.ts](#6-preload-bridge--preloadts)
7. [Shared Types Layer](#7-shared-types-layer)
8. [Frontend — React Renderer](#8-frontend--react-renderer)
   - 8.1 [Component Tree](#81-component-tree)
   - 8.2 [State Management — Zustand Stores](#82-state-management--zustand-stores)
   - 8.3 [Custom Hooks / Controllers](#83-custom-hooks--controllers)
   - 8.4 [Media Player Module](#84-media-player-module)
9. [IPC Communication Flow](#9-ipc-communication-flow)
10. [Download Lifecycle](#10-download-lifecycle)
11. [Engine Selection Logic](#11-engine-selection-logic)
12. [Build & Configuration](#12-build--configuration)
13. [Security Model](#13-security-model)
14. [Data Flow Diagram](#14-data-flow-diagram)

---

## 1. Project Overview

**Cortex DL** is a cross-platform desktop video/audio downloader built on Electron. It supports multiple download sources (YouTube, Facebook, Instagram, TikTok, direct HTTP links, HLS streams) and output formats (MP4, MKV, MP3, WAV, FLAC, etc.).

### Key Capabilities

| Feature | Details |
|---|---|
| URL Analysis | HLS master/media detection, yt-dlp metadata extraction, direct link detection |
| Download Engines | DirectEngine (chunked HTTP), YoutubeEngine (yt-dlp wrapper), FfmpegEngine (HLS/conversion) |
| Queue Management | Concurrent downloads (3/5/10), pause/resume/cancel/delete per task |
| Persistence | SQLite (better-sqlite3) with WAL mode; state survives app restart |
| Media Playback | Built-in HTTP streaming server (port 3345) + React media player |
| Auto-Update | electron-updater integration; self-update and self-uninstall |
| Security | contextIsolation=true, sandbox=true, SafeStorage for credentials, HTTP-only IPC |

---

## 2. Directory Structure

```
Cortex DL/
├── app/                               # Main application package
│   ├── Back-End/
│   │   └── electron/                  # Electron main process source
│   │       ├── main.ts                # App entry point, window creation, service bootstrap
│   │       ├── preload.ts             # Secure contextBridge (window.cortexDl API)
│   │       ├── tray.ts                # System tray icon & menu management
│   │       ├── downloadManager.ts     # Queue orchestrator (concurrent scheduling)
│   │       ├── db.ts                  # SQLite setup & prepared statements (WAL mode)
│   │       ├── utils.ts               # Pure utility functions (shared across modules)
│   │       ├── paths.ts               # Binary & resource path resolution (dev vs prod)
│   │       ├── ytdlp.ts               # yt-dlp analysis, update, stream URL extraction
│   │       ├── hls.ts                 # HLS m3u8 parser & stream variant analyzer
│   │       ├── ffmpegEngine.ts        # FFmpeg-based HLS/stream download engine
│   │       ├── progressParser.ts      # yt-dlp/ffmpeg stdout/stderr progress parser
│   │       ├── commentsExtractor.ts   # YouTube comments extraction via yt-dlp
│   │       ├── types.ts               # Backend type re-exports + internal types
│   │       ├── electron-env.d.ts      # Electron environment type declarations
│   │       ├── ipc/
│   │       │   └── handlers.ts        # Centralized ipcMain.handle registrations
│   │       └── engines/
│   │           ├── IEngine.ts         # Engine interface contract
│   │           ├── DirectEngine.ts    # Chunked HTTP downloader (axios, 8 parallel chunks)
│   │           ├── YoutubeEngine.ts   # yt-dlp process wrapper (YouTube/social platforms)
│   │           ├── FfmpegEngine.ts    # FFmpeg HLS/stream download engine (stub/delegator)
│   │           └── MediaProcessor.ts  # FPS detection via ffprobe
│   ├── Front-End/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx               # React entry point
│   │       ├── App.tsx                # Root component, routing, IPC listeners
│   │       ├── App.css                # Global styles (~56 KB)
│   │       ├── translations.ts        # i18n strings (Arabic + English)
│   │       ├── vite-env.d.ts          # Vite/Electron environment type declarations
│   │       ├── components/
│   │       │   ├── AddDownloadTab.tsx         # URL input, analysis, format picker (main)
│   │       │   ├── AddDownloadTab/            # Sub-views for AddDownloadTab
│   │       │   │   ├── UrlAnalysisView.tsx    # Analysis result display & format selection
│   │       │   │   ├── PlaylistView.tsx       # Playlist item listing & batch selection
│   │       │   │   └── BatchListView.tsx      # Batch download queue preview
│   │       │   ├── DownloadList.tsx           # Downloads queue list
│   │       │   ├── DownloadCard.tsx           # Individual download card UI
│   │       │   ├── DownloadCard.css           # Styles for download card component
│   │       │   ├── SettingsTab.tsx            # App settings panel
│   │       │   ├── Sidebar.tsx                # Navigation sidebar
│   │       │   ├── AdvancedTrimmer.tsx        # Video start/end time trim controls
│   │       │   ├── AdvancedTrimmer.css        # Styles for advanced trimmer component
│   │       │   ├── AnimatedSegmentedControl.tsx
│   │       │   ├── CustomDropdown.tsx
│   │       │   ├── SimpleDownloader.tsx       # Quick-download mode (no analysis)
│   │       │   ├── ConfirmModal.tsx           # Generic confirmation dialog
│   │       │   └── MediaPlayer/
│   │       │       ├── MediaPlayerModal.tsx   # Full-screen player modal
│   │       │       ├── MediaPlayer.css        # Styles for the media player
│   │       │       ├── VideoPlayerView.tsx    # <video> element + HTTP server URL
│   │       │       ├── AudioPlayerView.tsx    # <audio> element + waveform display
│   │       │       ├── PlayerControls.tsx     # Playback controls (seek, volume, speed)
│   │       │       └── MediaInfoOverlay.tsx   # File metadata overlay (FPS, codec, etc.)
│   │       ├── hooks/
│   │       │   ├── types.ts                   # Shared hook-level TypeScript types
│   │       │   ├── useDownloadController.ts   # Core download logic hook
│   │       │   ├── useHighFrequencyIPC.ts     # Throttled IPC listener & store sync
│   │       │   ├── useDownloadCardVM.ts       # View-model for a single DownloadCard
│   │       │   ├── useAppController.ts        # App-level logic (updater, concurrency)
│   │       │   ├── useSettingsController.ts   # Settings persistence & folder selection
│   │       │   ├── useCommentsController.ts   # Comments download flow + progress
│   │       │   └── useDebounce.ts             # Generic debounce hook
│   │       ├── stores/
│   │       │   ├── downloadStore.ts           # Zustand — download tasks state
│   │       │   └── useUIStore.ts              # Zustand — UI state (tabs, panels)
│   │       └── constants/
│   │           └── formats.ts                 # Supported format constants
│   ├── Shared/
│   │   └── types.ts                   # Single source of truth for all shared types
│   ├── bin/                           # Bundled binaries
│   │   ├── yt-dlp.exe                 # yt-dlp download engine
│   │   └── ffmpeg.exe                 # FFmpeg media processor
│   ├── build/                         # Electron-builder resources (icons, assets)
│   ├── release/                       # Output directory for packaged installers
│   ├── .env                           # Local environment variables (not committed)
│   ├── .env.example                   # Environment variable template
│   ├── vite.config.ts                 # Vite + vite-plugin-electron configuration
│   ├── tsconfig.json                  # TypeScript config (renderer + main)
│   ├── tsconfig.node.json             # TypeScript config (Node.js / Electron main)
│   ├── electron-builder.json5         # Packaging & installer configuration
│   └── package.json                   # App dependencies & scripts
└── package.json                       # Root workspace package
```

---

## 3. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Desktop Shell | Electron | ^30.0.1 |
| Frontend Framework | React | ^18.2.0 |
| Language | TypeScript | 5.5.4 |
| Build Tool | Vite + vite-plugin-electron | ^5.1.6 / ^0.28.6 |
| State Management | Zustand | ^5.0.11 |
| Animation | Framer Motion | ^10.12.16 |
| Icons | Lucide React | ^0.563.0 |
| HTTP Client | Axios | ^1.14.0 |
| Database | better-sqlite3 | ^12.8.0 |
| Logging | electron-log | ^5.4.3 |
| Auto-Update | electron-updater | ^6.7.3 |
| Download Engine | yt-dlp (binary) | Latest |
| Media Processing | ffmpeg/ffprobe (binary) | Bundled |
| Packaging | electron-builder | ^24.13.3 |

---

## 4. Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                  RENDERER PROCESS (React)                │
│  AddDownloadTab  DownloadList  SettingsTab  MediaPlayer  │
│       ↕ hooks/controllers ↕ Zustand stores              │
└────────────────────────┬────────────────────────────────┘
                         │  contextBridge (window.cortexDl)
                         │  IPC: invoke / on / off
┌────────────────────────┴────────────────────────────────┐
│                     PRELOAD SCRIPT                       │
│              (contextIsolation sandbox)                  │
└────────────────────────┬────────────────────────────────┘
                         │  ipcMain.handle / webContents.send
┌────────────────────────┴────────────────────────────────┐
│                MAIN PROCESS (Node.js)                    │
│  main.ts → DownloadManager → Engines → yt-dlp/ffmpeg    │
│            SQLite DB ← State Persistence                 │
│            HTTP Media Server (port 3345)                 │
│            electron-updater (auto-update)                │
└─────────────────────────────────────────────────────────┘
                    ↕ Shared/types.ts
```

---

## 5. Backend — Electron Main Process

### 5.1 Entry Point — `main.ts`

**File:** `app/Back-End/electron/main.ts` (870 lines)

Responsibilities:
- App lifecycle management (`app.whenReady`, `before-quit`, `window-all-closed`)
- Single-instance lock enforcement (`app.requestSingleInstanceLock`)
- GPU hardware acceleration flags
- `BrowserWindow` creation (1100×720, `contextIsolation:true`, `sandbox:true`)
- System tray management (minimize-to-tray behavior)
- Session-level CORS header injection for remote media streams
- Media streaming HTTP server startup
- Deferred backend service loading (1500ms after app ready)
- All `ipcMain.handle` registrations

**Initialization sequence:**
```
app.whenReady()
  ├── startMediaStreamingServer()   // Port 3345
  ├── createWindow()                // BrowserWindow
  ├── createTray()                  // System tray
  └── setTimeout(1500ms)
        └── loadBackendServices()
              ├── import electron-updater
              ├── import DownloadManager
              ├── new DownloadManager().attachWindow(win)
              ├── serviceReadyResolve()   // Unblocks IPC queue
              └── autoUpdater.checkForUpdatesAndNotify()
```

**Key exported constants:**
```typescript
export const VITE_DEV_SERVER_URL  // Dev vs production detection
export const MAIN_DIST            // dist-electron/ path
export const RENDERER_DIST        // Front-End/dist/ path
export let   MEDIA_SERVER_PORT    // Dynamic port (default 3345)
```

---

### 5.2 IPC API Surface

All IPC channels use the `cortexdl:` namespace prefix. The table below lists every registered handler:

#### File & System

| Channel | Direction | Description |
|---|---|---|
| `cortexdl:select-folder` | invoke | Native folder picker dialog |
| `cortexdl:select-cookies-file` | invoke | Native file picker (.txt) |
| `cortexdl:open-folder` | invoke | Open folder in Explorer (show file) |
| `cortexdl:open-file` | invoke | Open file with default app |
| `cortexdl:open-external` | invoke | Open URL in browser (http/https only) |
| `cortexdl:show-main-window` | invoke | Restore/focus the main window |

#### Downloads

| Channel | Direction | Description |
|---|---|---|
| `cortexdl:downloads:list` | invoke | Returns `DownloadTask[]` |
| `cortexdl:downloads:add` | invoke | Add single download `(StartInput)` |
| `cortexdl:downloads:add-batch` | invoke | Add multiple downloads `(StartInput[])` |
| `cortexdl:downloads:pause` | invoke | Pause by `id` |
| `cortexdl:downloads:resume` | invoke | Resume by `id` |
| `cortexdl:downloads:cancel` | invoke | Cancel by `id` |
| `cortexdl:downloads:delete` | invoke | Delete task + optional file |
| `cortexdl:downloads:clear-completed` | invoke | Remove completed/canceled tasks |
| `cortexdl:downloads:pause-all` | invoke | Pause all active |
| `cortexdl:downloads:resume-all` | invoke | Resume all paused/errored |
| `cortexdl:set-concurrency` | invoke | Set max concurrent (3/5/10) |
| `cortexdl:get-concurrency` | invoke | Get current max concurrent |

#### Analysis & Engine

| Channel | Direction | Description |
|---|---|---|
| `cortexdl:analyze-url` | invoke | Analyze URL → `AnalyzeResult` |
| `cortexdl:get-direct-stream-url` | invoke | Get playable stream URL via yt-dlp `-g` |
| `cortexdl:update-engine` | invoke | Download latest yt-dlp binary |
| `cortexdl:get-engine-version` | invoke | Get current yt-dlp version string |

#### Media

| Channel | Direction | Description |
|---|---|---|
| `cortexdl:fetch-thumbnail` | invoke | Fetch & cache thumbnail → local file path |
| `cortexdl:get-media-port` | invoke | Get media streaming server port |
| `cortexdl:get-media-fps` | invoke | Get FPS of local file via ffprobe |
| `cortexdl:download-comments` | invoke | Extract & save YouTube comments to file |

#### Security

| Channel | Direction | Description |
|---|---|---|
| `cortexdl:secure-save` | invoke | Encrypt value via `safeStorage` → Base64 |
| `cortexdl:secure-get` | invoke | Decrypt Base64 → plain value |

#### App Updates

| Channel | Direction | Description |
|---|---|---|
| `cortexdl:check-for-updates` | invoke | Trigger update check |
| `cortexdl:restart-app` | invoke | Quit and install update |
| `cortexdl:uninstall-app` | invoke | Wipe data + run uninstaller |

#### Push Events (Main → Renderer)

| Channel | Description |
|---|---|
| `cortexdl:download-updated` | Task state changed (throttled ~5/sec) |
| `cortexdl:download-progress` | Progress tick event |
| `cortexdl:download-stats-updated` | `{ id, addedBytes }` for bandwidth tracking |
| `cortexdl:comments-extraction-started` | Comments extraction began |
| `cortexdl:comments-progress` | `(current, total)` comments pages |
| `update-status` | Auto-updater status events |

---

### 5.3 Download Manager

**File:** `app/Back-End/electron/downloadManager.ts` (638 lines)

The `DownloadManager` class is the orchestrator for all download tasks. It manages:

#### Internal State
```typescript
private tasks   = new Map<string, DownloadTask>()   // All tasks by ID
private runtime = new Map<string, TaskRuntime>()    // Per-task process handles
private engines = new Map<string, IEngine>()        // Active engine instances
private active  = new Set<string>()                 // Currently running IDs
private maxConcurrent = 3                           // Queue concurrency limit
private win: BrowserWindow | null                   // Window ref for IPC
```

#### Lifecycle Methods

| Method | Description |
|---|---|
| `constructor()` | `loadState()` from SQLite + `hydrateConcurrency()` |
| `add(input)` | Validate URL, build `DownloadTask`, persist, schedule |
| `addBatch(inputs)` | Bulk add with 100ms delay before scheduling |
| `pause(id)` | Abort controller, kill process tree, set `paused` |
| `resume(id)` | Reset to `queued`, trigger scheduler |
| `cancel(id)` | Kill process, set `canceled`, delete partial file |
| `delete(id, deleteFile)` | Remove from DB + optional file deletion |
| `clearCompleted()` | Remove completed/canceled from DB |
| `pauseAll()` | Pause all downloading/queued |
| `resumeAll()` | Resume all paused/errored |
| `flushPendingSave()` | Called on `before-quit` for crash-safe persistence |

#### Queue Scheduler

```
schedule()
  ├── available = maxConcurrent - active.size
  ├── candidates = tasks.filter(queued).sort(createdAtMs ASC)
  └── for candidate in candidates[0..available]:
        ├── active.add(id)
        └── executeEngine(id)  // async, non-blocking
```

#### Engine Execution Flow

```
executeEngine(id)
  ├── task.status = 'downloading'
  ├── entry = engines.get(task.engine)  // DirectEngine | YoutubeEngine | FfmpegEngine
  ├── context = createContext(id)       // Inject sendUpdate, saveState, sendStats
  ├── await entry.start(engine, task, context)
  ├── if aborted/paused: return (engine sets own status)
  ├── task.status = 'completed'
  └── finally: active.delete, saveImmediate, sendUpdate, schedule()
```

#### State Persistence

| Method | When Called | What Writes |
|---|---|---|
| `saveStateImmediate(id?)` | On lifecycle transitions | Full task JSON payload |
| `saveStateDebounced()` | During active downloads | Active tasks only (WAL mode) |
| `flushPendingSave()` | Before quit | All tasks |

**Orphan cleanup:** On startup, scans all download directories for `{uuid}.*` temp files whose UUID does not match any known task and deletes them.

---

### 5.4 Engine System

**Interface:** `app/Back-End/electron/engines/IEngine.ts`
```typescript
export interface IEngine {
  download(task: DownloadTask, context?: EngineContext): Promise<void>
  pause(): void
  stop(): void
}
```

#### DirectEngine (`engines/DirectEngine.ts`)

HTTP-only downloader using **axios** with parallel chunking.

```
download()
  ├── HEAD request → Content-Length + Accept-Ranges
  ├── If file ≥ 5MB AND Accept-Ranges: bytes
  │     └── downloadWithChunking()   // 8 parallel chunks, r+ file write
  └── Else
        └── downloadSingleStream()   // stream → pipeline → writeStream
```

Key parameters:
- `NUM_CHUNKS = 8` — Parallel range requests
- `MIN_FILE_SIZE_FOR_CHUNKING = 5MB`
- `MAX_RETRIES = 3` per chunk (exponential backoff: 200ms, 400ms, 800ms)
- Progress update throttle: every 100ms or 1MB

#### YoutubeEngine (`engines/YoutubeEngine.ts`)

Wraps the **yt-dlp** binary for supported platforms (YouTube, Facebook, Instagram, TikTok, etc.).

**Download profiles** (selected based on `targetFormat`):

| Profile | Trigger | yt-dlp flags |
|---|---|---|
| `proAudio` | `mp3` | `-x --audio-format mp3 --audio-quality 0 -f bestaudio/best` |
| `bestVideo` | `mp4` | `-f bestvideo[ext=mp4]+bestaudio[ext=m4a]/best --merge-output-format mp4` |
| `default` | all others | format-specific audio/video selection |

**Key features:**
- Metadata prefetch (title, thumbnail, duration) via `--dump-json`
- Cookie support: `cookies.txt` file → `--cookies-from-browser` → none
- Speed limit support via `--limit-rate`
- Time-range trimming via `--download-sections *start-end`
- Auto-retry up to 5 times with exponential backoff (3s → 60s max)
- Temp files stored in `.cortex_temp/` subfolder, renamed post-download
- Post-processing: GIF conversion (fps=15, scale=480:-1), WMA encoding

**Progress parsing:** Uses `--progress-template` markers (`CORTEX_DL:` / `CORTEX_PP:`) parsed by `progressParser.ts`.

#### FfmpegEngine (`engines/FfmpegEngine.ts`)

Used for HLS stream downloads and format conversion tasks.

#### MediaProcessor (`engines/MediaProcessor.ts`)

Used only for FPS detection via `ffprobe`. Not a download engine.

---

### 5.5 URL Analysis Pipeline

```
cortexdl:analyze-url (url, browser?)
  │
  ├── analyzeUrlForHls(url)         // hls.ts
  │     ├── If not .m3u8 URL → { kind: 'direct' }
  │     ├── Fetch URL content
  │     ├── If #EXTM3U not found → { kind: 'unknown' }
  │     ├── If no #EXT-X-STREAM-INF → { kind: 'hls-media', url }
  │     └── Parse variants → { kind: 'hls-master', variants[] }
  │
  └── If kind === 'unknown' | 'direct':
        └── analyzeWithYtdlp(url, browser)   // ytdlp.ts
              ├── Cache check (5-min TTL, 50-entry LRU)
              ├── yt-dlp --dump-single-json
              ├── If playlist → { kind: 'playlist', items[] }
              ├── If video → { kind: 'ytdlp', formats[], stats }
              └── Return youtube-dislike API data for dislikes
```

**AnalyzeResult type union:**
```typescript
type AnalyzeResult =
  | { kind: 'unknown' }
  | { kind: 'direct' }
  | { kind: 'hls-media';   url: string }
  | { kind: 'hls-master';  variants: HlsVariant[] }
  | { kind: 'ytdlp';       title, thumbnail, formats, views, likes, dislikes, duration }
  | { kind: 'playlist';    title, items[] }
```

---

### 5.6 Media Streaming Server

**Location:** `main.ts` — `startMediaStreamingServer()`

An in-process HTTP server on `127.0.0.1:3345` that serves local media files to the React renderer's `<video>` / `<audio>` tags.

**Security:**
- Origin validation: Only accepts requests from the Vite dev server (dev) or `file://` (production)
- Path traversal protection: `path.normalize()` + `path.isAbsolute()` check
- MIME whitelist: Only video/audio/image extensions allowed
- `EADDRINUSE` auto-retry: Up to 10 ports (3345–3354)

**HTTP Features:**
- `Range` header support → `206 Partial Content` (enables seeking)
- `HEAD` method support
- Stream cleanup on `req.close` / `req.aborted` to prevent FD leaks
- CORS headers: `Access-Control-Allow-Origin`, `Accept-Ranges`, `Content-Range`

**Supported MIME types:**
```
Video:  mp4, mkv, avi, mov, webm, ogv, m4v
Audio:  mp3, wav, m4a, ogg, flac, aac, opus, wma
Image:  jpg, jpeg, png, webp, gif, avif
```

---

### 5.7 Database Layer — SQLite

**File:** `app/Back-End/electron/db.ts`

```typescript
// Location: %APPDATA%/Cortex DL/tasks.sqlite
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')       // Write-Ahead Logging for performance
db.pragma('auto_vacuum = INCREMENTAL')
```

**Schema:**
```sql
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT,
  url          TEXT,
  status       TEXT,
  progress     REAL,
  size         INTEGER,
  thumbnail    TEXT,
  engine       TEXT,
  full_payload TEXT    -- Complete DownloadTask JSON
)

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
)
```

**Prepared statements (`taskDb`):**

| Statement | Operation |
|---|---|
| `upsertTask` | INSERT OR REPLACE full task row |
| `updateStatusAndProgress` | Lightweight status/progress update (active downloads) |
| `deleteTask` | DELETE by id |
| `getAllTasks` | SELECT full_payload FROM tasks |
| `clearCompleted` | DELETE WHERE status = 'completed' OR 'canceled' |

---

### 5.8 yt-dlp Module

**File:** `app/Back-End/electron/ytdlp.ts` (686 lines)

Responsibilities:
1. **Analysis** (`analyzeWithYtdlp`) — `--dump-single-json` parsing
2. **Stream URL extraction** (`getDirectStreamUrl`) — `-g` flag with format fallback chain
3. **Binary update** (`updateYtdlp`) — GitHub Releases API → download → atomic replace
4. **Version check** (`getYtdlpVersion`) — `--version` flag with 5s timeout
5. **JS runtime detection** (`getJsRuntimeArgs`) — Deno → Node → Electron's execPath

**Analysis cache:** In-memory `Map<url, { result, timestamp }>`, TTL=5min, max=50 entries (LRU eviction of oldest on overflow).

**Format selector fallback chain (getDirectStreamUrl):**
```
1. "22/18"       → YouTube native pre-merged h264+AAC (720p/360p)
2. "b[ext=mp4]"  → Best muxed MP4 (non-YouTube)
3. "best"        → Legacy catch-all
```

---

### 5.9 Comments Extractor

**File:** `app/Back-End/electron/commentsExtractor.ts`

Uses yt-dlp with `--get-comments` flag to extract YouTube comments, then saves them to a user-specified `.txt` file. Progress is streamed back via IPC `cortexdl:comments-progress` events.

---

### 5.10 Paths Module

**File:** `app/Back-End/electron/paths.ts`

Centralizes binary and resource path resolution for dev vs. production:

```typescript
export function getBinaryPath(name: string): string
//  Dev:  $APP_ROOT/bin/{name}.exe
//  Prod: process.resourcesPath/bin/{name}.exe

export function getBinDirectory(): string
export function getCookiesPath(): string | null  // Looks for cookies.txt
export const isDev: boolean                      // !app.isPackaged
```

---

### 5.11 Utils Module

**File:** `app/Back-End/electron/utils.ts`

Pure utility functions shared across all modules:

| Function | Description |
|---|---|
| `sanitizeFilename(name)` | Whitelist: English/Arabic letters, numbers, `-`, `_` |
| `withExtension(file, ext)` | Replace/add extension |
| `parseFilenameFromUrl(url)` | Extract filename from URL path |
| `getDefaultFilename(url)` | `parseFilenameFromUrl` or `'download'` |
| `isHttpUrl(url)` | Validates `http:`/`https:` protocol |
| `isM3u8Url(url)` | Regex check for `.m3u8` extension |
| `nowMs()` | `Date.now()` alias |
| `parseTimeToSeconds(ts)` | `HH:MM:SS.ss` → seconds |
| `computeSpeed(task, runtime)` | Update `speedBytesPerSec` (sampled every 800ms) |
| `ensureDirectoryExists(dir)` | `fs.mkdir({ recursive: true })` |
| `getFileSizeIfExists(path)` | `fs.stat().size` or `0` |
| `parseTotalFromContentRange(header)` | Parse `Content-Range: bytes X-Y/Total` |
| `sendUpdate(win, task)` | Raw IPC push (no throttle) |
| `throttledSendUpdate(win, task, runtime)` | IPC throttle: 200ms / instant for state changes |
| `sendNotification(title, body)` | System notification (if supported) |
| `killProcessTree(child)` | `taskkill /F /T` on Windows, `-SIGKILL` on POSIX |

---

### 5.12 Progress Parser

**File:** `app/Back-End/electron/progressParser.ts`

Parses yt-dlp and ffmpeg stdout/stderr output into structured progress data.

**yt-dlp custom template:**
```
--progress-template download:CORTEX_DL:%(progress.downloaded_bytes)s:%(progress.total_bytes_estimate)s:%(progress.speed)s
--progress-template postprocess:CORTEX_PP:%(info.filepath)s
```

Transitions detected:
- `CORTEX_DL:bytes:total:speed` → update `downloadedBytes`, `totalBytes`, `speedBytesPerSec`
- `CORTEX_PP:filepath` → capture final output path
- `[ffmpeg]` lines → `task.status = 'merging'`
- `[ExtractAudio]` / conversion lines → `task.status = 'converting'`

---

## 6. Preload Bridge — `preload.ts`

**File:** `app/Back-End/electron/preload.ts` (138 lines)

Exposes `window.cortexDl` via `contextBridge.exposeInMainWorld`. Every method maps 1:1 to an IPC channel or event listener.

```typescript
contextBridge.exposeInMainWorld('cortexDl', {
  // File system
  selectFolder(), selectCookiesFile(), openFolder(), openFile(), openExternal(), showMainWindow()

  // Downloads
  listDownloads(), addDownload(), addBatchDownloads()
  pauseDownload(), resumeDownload(), cancelDownload(), deleteDownload()
  clearCompleted(), pauseAll(), resumeAll()
  setConcurrency(), getConcurrency()

  // Analysis & Engine
  analyzeUrl(), getDirectStreamUrl(), updateEngine(), getEngineVersion()

  // Media
  fetchThumbnail(), getMediaPort(), getMediaFps()

  // Security
  saveSecureData(), getSecureData()   // Uses localStorage for encrypted Base64 storage

  // Comments
  downloadComments(), onCommentsExtractionStarted(), onCommentsProgress()

  // Push Events (return cleanup unsubscribe functions)
  onDownloadUpdated(), onDownloadProgress(), onStatsUpdated()
  onUpdateStatus()

  // App Updates
  checkForUpdates(), restartApp(), uninstallApp()
})
```

**Secure credential flow:**
```
saveSecureData(key, value)
  → ipcRenderer.invoke('cortexdl:secure-save', key, value)
  → Main: safeStorage.encryptString(value) → Base64
  → Preload: localStorage.setItem(`secure_${key}`, base64)

getSecureData(key)
  → localStorage.getItem(`secure_${key}`) → base64
  → ipcRenderer.invoke('cortexdl:secure-get', base64)
  → Main: safeStorage.decryptString(Buffer.from(base64, 'base64'))
```

---

## 7. Shared Types Layer

**File:** `app/Shared/types.ts` (Single source of truth for all types shared between main and renderer)

```typescript
type DownloadStatus = 'queued' | 'downloading' | 'merging' | 'converting' | 'paused' | 'completed' | 'error' | 'canceled'
type DownloadEngine = 'direct' | 'ffmpeg' | 'ytdlp'
type VideoFormat    = 'mp4' | 'mkv' | 'avi' | 'mov' | 'webm' | 'ogv' | 'm4v' | 'gif'
type AudioFormat    = 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac' | 'aac' | 'opus' | 'wma'
type TargetFormat   = VideoFormat | AudioFormat

type DownloadTask = {
  id, url, directory, filename, filePath, engine, targetFormat
  status, totalBytes, downloadedBytes, speedBytesPerSec, errorMessage
  createdAtMs, updatedAtMs
  // Optional:
  title, thumbnail, cookieBrowser, cookieFile, username, password
  speedLimit, startTime, endTime, ytdlpFormatId, fps
  convertingPercent, downloadPercent
}

type AnalyzeResult = unknown | direct | hls-media | hls-master | ytdlp | playlist

// IPC channel name constants:
const UPDATE_CHANNEL   = 'cortexdl:download-updated'
const PROGRESS_CHANNEL = 'cortexdl:download-progress'
const STATS_CHANNEL    = 'cortexdl:download-stats-updated'
```

---

## 8. Frontend — React Renderer

### 8.1 Component Tree

```
App.tsx  (root, IPC listeners setup, tab routing)
├── Sidebar.tsx               Navigation tabs
├── AddDownloadTab.tsx         URL input + analysis + download start
│   ├── CustomDropdown.tsx     Format/quality picker
│   ├── AnimatedSegmentedControl.tsx
│   ├── AdvancedTrimmer.tsx   Start/end time selector
│   └── SimpleDownloader.tsx  Quick mode (no analysis)
├── DownloadList.tsx           Queue list
│   └── DownloadCard.tsx       Per-task card
│       ├── [thumbnail]
│       ├── [progress bar]
│       └── [action buttons: pause/resume/cancel/delete/open]
├── SettingsTab.tsx            App settings
│   └── AuthenticationSettings.tsx
├── ConfirmModal.tsx           Generic confirmation dialog
└── MediaPlayer/
    └── MediaPlayerModal.tsx  Full-screen player
        ├── VideoPlayerView.tsx  <video> element + HTTP server URL
        ├── AudioPlayerView.tsx  <audio> element
        ├── PlayerControls.tsx   Playback controls
        └── MediaInfoOverlay.tsx File info overlay
```

### 8.2 State Management — Zustand Stores

#### `downloadStore.ts`
```typescript
interface DownloadStore {
  tasks: DownloadTask[]
  setTasks(tasks)
  upsertTask(task)           // Called on 'cortexdl:download-updated' IPC event
}
```

#### `useUIStore.ts`
```typescript
interface UIStore {
  activeTab: string
  // UI toggles, panel states, etc.
}
```

### 8.3 Custom Hooks / Controllers

| Hook | Description |
|---|---|
| `useDownloadController` | Main hook: analyzeUrl, addDownload, pause/resume/cancel/delete/batch |
| `useHighFrequencyIPC` | Subscribes to `onDownloadUpdated` + `onStatsUpdated`; throttled store updates |
| `useDownloadCardVM` | View-model for a single `DownloadCard`: computed display values, action handlers |
| `useAppController` | App-level: updater status, concurrency setting, engine version |
| `useSettingsController` | Settings persistence, download folder selection |
| `useCommentsController` | Comments download flow + progress tracking |
| `useDebounce` | Generic debounce hook |

### 8.4 Media Player Module

The `MediaPlayerModal` component:
1. Calls `window.cortexDl.getMediaPort()` to get the local server port
2. Constructs a `http://127.0.0.1:{port}/?path={filePath}` URL
3. Passes it to `<video src>` or `<audio src>` for native playback
4. Supports range requests → seeking works out of the box
5. Calls `getMediaFps()` to display framerate info

---

## 9. IPC Communication Flow

```
Renderer (React)
  │
  │  window.cortexDl.addDownload(input)
  ↓
Preload (contextBridge)
  │
  │  ipcRenderer.invoke('cortexdl:downloads:add', input)
  ↓
Main Process (ipcMain.handle)
  │
  │  await serviceReadyPromise    ← blocks until DownloadManager is ready
  │  downloads.add(input)
  │    ├── Validate URL
  │    ├── Build DownloadTask
  │    ├── tasks.set(id, task)
  │    ├── saveStateImmediate()   → SQLite upsert
  │    ├── sendUpdate(win, task)  → push to renderer
  │    └── schedule()            → start download if slot available
  ↓
Return DownloadTask to renderer
  │
  ↓
Renderer updates Zustand store (upsertTask)
```

**Push event flow (progress updates):**
```
Main: win.webContents.send('cortexdl:download-updated', task)
  ↓
Preload: ipcRenderer.on → calls registered callback
  ↓
Renderer: useHighFrequencyIPC → upsertTask(task) in Zustand store
  ↓
React re-renders DownloadCard (throttled, ~5/sec)
```

---

## 10. Download Lifecycle

```
StartInput received
      │
      ▼
  [queued]  ←────────────────────────────┐
      │                                   │
      │  schedule() picks task            │  retry (up to 5x)
      ▼                                   │
[downloading] ──── yt-dlp/axios ──────── ┘
      │
      ├──[merging]     (yt-dlp ffmpeg post-processing)
      │
      ├──[converting]  (format conversion, e.g., gif/wma)
      │
      ├──► [completed] ─── rename file, sendNotification, flush DB
      │
      ├──► [error]     ─── store errorMessage
      │
      ├──► [paused]    ─── kill process, save state
      │
      └──► [canceled]  ─── kill process, delete partial file
```

---

## 11. Engine Selection Logic

```typescript
// In DownloadManager.detectEngine()
function detectEngine(url: string): DownloadEngine {
  if (
    url includes 'youtube.com' | 'youtu.be' |
                 'facebook.com' | 'instagram.com' |
                 'twitter.com'  | 'tiktok.com'
  ) return 'ytdlp'
  return 'direct'
}

// User can override with: engine = 'auto' | 'direct' | 'ytdlp' | 'ffmpeg'
```

**HLS streams** detected during analysis → engine set to `'ffmpeg'` automatically.

---

## 12. Build & Configuration

### `vite.config.ts`

```typescript
{
  root: './Front-End',          // Renderer source
  build: { minify: 'esbuild' },
  plugins: [
    react(),
    electron({
      main:    { entry: './Back-End/electron/main.ts',    outDir: 'dist-electron' },
      preload: { entry: './Back-End/electron/preload.ts', outDir: 'dist-electron' },
      // external: ['better-sqlite3']  // Native module, not bundled
    })
  ]
}
```

### Scripts

| Script | Command |
|---|---|
| Dev server | `npm run dev` → Vite HMR + Electron |
| Build + Package | `npm run build` → tsc + vite build + electron-builder |
| Lint | `npm run lint` |

### `electron-builder.json5`

Packages the app for Windows (NSIS installer). Bundles:
- `bin/` directory (yt-dlp.exe, ffmpeg.exe, ffprobe.exe)
- `cookies.txt` (if present)
- All compiled JS + assets

---

## 13. Security Model

| Concern | Mitigation |
|---|---|
| Node.js in renderer | `nodeIntegration: false`, `sandbox: true` |
| Context isolation | `contextIsolation: true` — no direct Node access |
| IPC surface | Only whitelisted methods via `contextBridge` |
| External URLs | `shell.openExternal` restricted to `http:`/`https:` only |
| File path traversal | `path.normalize()` + `path.isAbsolute()` in media server |
| Media server CORS | Origin validated against known dev/prod URL |
| MIME type whitelist | Only video/audio/image extensions served |
| Credential storage | `electron.safeStorage` encryption → stored as Base64 in localStorage |
| Subfolder injection | `safeSubfolder.replace(/[\/\\:*?"<>|]/g, '')` |
| URL validation | `isHttpUrl()` check before adding any download |
| Single instance | `app.requestSingleInstanceLock()` prevents multiple processes |
| Window link hijacking | `setWindowOpenHandler` denies popups, opens in browser |
| CORS for CDN streams | Session-level response header injection (limited to non-localhost http URLs) |

---

## 14. Data Flow Diagram

```
                        ┌──────────────────────────────┐
                        │      User (Browser UI)        │
                        │  Paste URL → Click Download   │
                        └──────────────┬───────────────┘
                                       │
                         window.cortexDl.analyzeUrl(url)
                                       │
                        ┌──────────────▼───────────────┐
                        │         preload.ts            │
                        │  ipcRenderer.invoke(channel)  │
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │          main.ts              │
                        │  ipcMain.handle(channel)      │
                        └──────────┬────────────────────┘
                                   │
                    ┌──────────────┴──────────────────┐
                    ▼                                 ▼
          analyzeUrlForHls()             analyzeWithYtdlp()
          [hls.ts]                       [ytdlp.ts]
          - Fetch .m3u8                  - yt-dlp --dump-json
          - Parse variants               - Cache result
                    │                                 │
                    └────────────┬────────────────────┘
                                 │ AnalyzeResult
                        ┌────────▼────────┐
                        │  AddDownloadTab  │ (React)
                        │  Show formats,  │
                        │  quality picker │
                        └────────┬────────┘
                                 │ user selects format
                    window.cortexDl.addDownload(StartInput)
                                 │
                        ┌────────▼────────────────────┐
                        │      DownloadManager         │
                        │  add() → tasks.set()         │
                        │  schedule() → executeEngine()│
                        └────────┬────────────────────┘
                                 │
             ┌───────────────────┼──────────────────────┐
             ▼                   ▼                       ▼
     DirectEngine          YoutubeEngine          FfmpegEngine
     (axios chunks)        (yt-dlp spawn)         (ffmpeg spawn)
             │                   │                       │
             └───────────────────┼───────────────────────┘
                                 │ context.sendUpdate(task)
                        ┌────────▼─────────────┐
                        │    IPC push event     │
                        │  cortexdl:download-   │
                        │     updated           │
                        └────────┬─────────────┘
                                 │
                        ┌────────▼─────────────┐
                        │   Zustand Store       │
                        │   upsertTask(task)    │
                        └────────┬─────────────┘
                                 │
                        ┌────────▼─────────────┐
                        │   DownloadCard        │
                        │   (React re-render)   │
                        │   Progress bar, speed │
                        └──────────────────────┘
```

---

*Generated: May 2026 | Cortex DL v1.4.0*
