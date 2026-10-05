# Visual Trim preview regression

The Add Download tab now passes its original yt-dlp URL to AdvancedTrimmer, including sources whose analyzed formats contain no direct URL. The analyzed duration remains the slider's authoritative maximum.

Preview extraction selects one progressive HTTP(S) resource, preferring H.264/AAC MP4 and compatible VP9 WebM, then H.264 video-only MP4. It validates extracted JSON metadata and rejects segmented manifests, separate resources, unsupported codecs/containers and expired signed URLs. Video-only preview is intentional: the muted preview does not need the final download's audio track.

The renderer attempts extraction first and uses the analyzed URL once on extraction or playback failure. Both renderer and Electron file logs preserve actual error details. Expiration checks recognize absolute Unix `expire`/`expires` values. Chromium network failures also report its original MediaError message; a generic 403 cannot conclusively distinguish expiry from access denial.

Trim state and Save Trim stay available throughout extraction and failure. Slider seeks are queued until metadata arrives and the latest requested position is reapplied when switching to fallback. Browser media resources are paused, detached and reloaded on close. Unique preview sessions register extraction processes with the existing media registry; closing a session cancels the process tree and waits for teardown. Late results cannot update a closed component.

Regression coverage in `tests/trimPreview.test.cjs`:

- Actual AddDownloadTab mounting with empty analyzed formats still opens Visual Trim and extracts the original URL.
- Real Electron decoding of H.264/AAC MP4; successful extraction displays the video.
- Extraction failure and video HTTP 403 fall back to a valid analyzed URL.
- Expired extracted and fallback URLs display diagnostics while Start/End still save.
- Start/end changes seek the real HTMLVideoElement; slider duration stays 664 seconds even when the preview fixture is shorter.
- 25 renderer sessions release their video sources, renderer heap growth stays below 8 MiB after forced garbage collection across 20 repeated sessions, and 20 real extraction processes are canceled and retired. Late extraction results are ignored.
- Actual bundled yt-dlp selector prefers a supported lower-resolution format over incompatible higher-resolution AV1 using saved extractor metadata.

These deterministic tests do not contact live YouTube. Authentication requirements, regional restrictions and service changes can still cause extraction failure, which remains visible and does not affect the final download's trim pipeline. Downloader Core V2 and final trimming were not modified.

Commands: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run build -- --publish never`.
The Electron renderer integration requires permission to launch Electron outside this desktop environment's restricted process sandbox.

Validation results:

- Typecheck and lint: passed.
- Unit tests: 18/18 passed.
- Integration suite: 44/44 passed, without skips.
- The five Visual Trim regression tests were rerun successfully after the final seek/fallback and precise renderer heap checks.
- Production Windows build: passed, installer in `release/2.0.0/Cortex DL Setup 2.0.0.exe`. No publishing was performed.

Modified files:

- `Front-End/src/components/AddDownloadTab.tsx`
- `Front-End/src/components/AdvancedTrimmer.tsx`
- `Front-End/src/components/trimPreview.ts`
- `Front-End/src/vite-env.d.ts`
- `Back-End/electron/ytdlp.ts`
- `Back-End/electron/previewExtraction.ts`
- `Back-End/electron/ipc/handlers.ts`
- `Back-End/electron/preload.ts`
- `tests/trimPreview.test.cjs`
- `tests/fixtures/trimPreviewElectron.cjs`
- `package.json`
- `docs/visual-trim-preview.md`
