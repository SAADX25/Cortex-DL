# Development guide

## Working layout

The application package and lockfile live in `app`; the repository root provides npm shortcuts, the development launcher, branding and contributor documents.

| Area | Responsibility |
| --- | --- |
| `Front-End/src/components` | React views and reusable UI components |
| `Front-End/src/hooks`, `actions`, `lib` | UI lifecycle, actions and renderer helpers |
| `Front-End/src/stores` | Zustand state for downloads, settings and UI |
| `Front-End/src/translations.ts` | Arabic and English UI strings |
| `Shared` | Renderer/backend types, analysis URLs and progress models |
| `Back-End/electron/ipc/handlers.ts` | IPC operations and input validation |
| `Back-End/electron/preload.ts` | Renderer bridge to Electron |
| `Back-End/electron/downloadManager.ts` | Queue, attempt ownership and state transitions |
| `Back-End/electron/engines` | Download backends and media processing |
| `Back-End/electron/db.ts` | SQLite persistence and recovery |
| `Back-End/electron/paths.ts`, `setup.ts`, `engineIntegrity.ts` | Runtime paths and engine provisioning |
| `build/installer.nsh` | Installer source; preserve this directory during cleanup |
| `scripts`, `tests`, `docs` | Maintenance tools, regression coverage and technical guides |

## Extension points

For a UI feature, keep the view in `components`, its state in the relevant store, and reusable actions or lifecycle work in `actions` or `hooks`. Add both translations and verify Arabic RTL layout.

For a new IPC operation, update shared contracts, the preload bridge and the backend handler together. Follow existing sender and input validation. Keep filesystem, database and child-process work in the backend.

For download or media changes, start with [downloader-core-v2.md](downloader-core-v2.md), [media-processing-performance.md](media-processing-performance.md) and the `IEngine` contract. Let the manager own task transitions. Preserve cancellation and attempt isolation, and validate media before publishing a final file. Exercise failure and pause/resume paths in regression tests.

For engine or packaging changes, keep `engines.lock.json`, notices, build metadata and release checks consistent. Development uses `engine-baseline`; mutable runtime engines live in the user's AppData directory. The old local `app/bin` directory is unused and can be cleaned.

## Commands

From the repository root:

```powershell
npm run setup          # Install the locked app dependencies
npm run dev            # Stage engines and launch development
npm run check          # TypeScript, ESLint and regression tests
npm run build          # Build the Windows installer
npm run clean:preview  # Inspect the standard cleanup plan
npm run clean          # Remove generated development and validation output
npm run clean:packaged # Also remove release/<version>/win-unpacked
```

Run `npm run engines:stage`, `npm run test:unit`, `npm run test:integration` and packaging validation commands from `app`. `check` needs staged engines for the tests that invoke real media tools. First-time dependency setup and engine staging require internet access.

## Generated files and local data

`scripts/clean.cjs` uses fixed cleanup targets, checks the app identity and refuses linked paths before deletion. `--dry-run` reports the plan without removing anything; `--packaged` additionally selects unpacked Windows builds in numeric version folders.

Standard cleanup removes `dist-electron`, `Front-End/dist`, `smoke-results`, `installer-validation`, the retired local `bin`, generated manifests/notices and generated Vite/TypeScript configuration outputs. The next development startup or build recreates required metadata and build output.

Keep `node_modules` for immediate development, `engine-baseline` for offline media tests, and the release installer/update files for distribution. Cleanup preserves `.env` and `.cortex_temp`, which may contain experiments, media or resumable downloads. Review those manually before deleting their contents. User history and settings in `%APPDATA%\cortex-dl` are outside project cleanup.

After `clean:packaged`, run a fresh build before packaged tests, license checks or release artifact verification. Stop running development and validation processes before cleanup.
