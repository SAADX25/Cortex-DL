# YouTube quality, captions and authentication reliability

Repository: SAADX25/Cortex-DL. App version: 2.2.0. Date: 2026-10-10 (Asia/Amman).
Branch: `codex/youtube-quality-subtitles-reliability`.
Base: `a2affc1cf005d6ae7e61a5dd92cafa3fc7712b64`, verified against remote master.
The final commit SHA is provided in the chat handoff and recorded in the candidate build manifest.

## Confirmed internal causes

- **Analysis omitted Deno initialization.** `analyzeWithYtdlp` built its arguments from an initially empty runtime selection. Preview/download initialized Deno, and visiting engine health could initialize it too, making behavior depend on earlier actions. Analysis now awaits the existing receipt-based engine readiness and runtime selection before extraction. This is a confirmed code defect capable of limiting formats; it is not proof that this caused the specific 360p screenshot.
- **Extractor warnings were suppressed.** Analysis and ordinary downloads used `--no-warnings`. Successful extraction now retains bounded diagnostics and records safe warning categories; the UI reports limited/restricted extraction instead of silently implying complete availability.
- **Generic cookie advice was classified as authentication.** The classifier recognized `use --cookies-from-browser or --cookies` as a sign-in requirement without independent evidence. Network, throttling, format and explicit PO-token diagnostics now have separate classifications.
- **Caption absence and failed discovery were conflated.** Metadata had a caption list without discovery state. Discovery now distinguishes `available`, `none-confirmed`, `restricted`, `rate-limited`, `unknown`, and UI `loading`. Independent caption refresh cannot replace or erase public video formats.
- **Cookie validation accepted a domain mention anywhere in the export.** Validation now parses Netscape rows, checks the actual YouTube domain and expiration, accepts HttpOnly rows, and explicitly says structural acceptance does not verify sign-in.
- **Authenticated operations could rewrite the original jar or send YouTube cookies to another extractor.** Authenticated analysis, preview, download, caption and comment operations use private temporary copies. YouTube cookies are scoped to YouTube URLs. Windows copies inherit a private directory ACL granting the current user; Unix permissions are 0700/0600. `finally` removes copies after settlement.
- **Subtitle playback could only select the first track.** The player now exposes language selection and off, resets tracks across sessions, applies selection after track load, and disables unselected tracks. External SRT goes through FFmpeg WebVTT conversion rather than being served directly as a browser subtitle.
- **Quality buckets could overstate actual dimensions.** For example, a 1012-line source was labeled 1080p and an empty yt-dlp result could display invented 4K/1080p choices. The quality list now uses discovered heights and does not invent yt-dlp resolutions.

Existing best-video-plus-best-audio selection, MKV intermediate merging, compatible stream copying, manager publication ownership, receipt caching, and Visual Trim lifecycle behavior remain in use.

## Upstream results and before/after evidence

| Case | Before | After / verified result |
| --- | --- | --- |
| Public extraction reports 1080p; authenticated fixture reports 360p | Existing public-first policy needed protection | Public 1080p remains selected; no account request on public success |
| Video-only 1080p plus separate audio | Selector already supported separate streams | Deterministic selector and real merge/progress regressions pass |
| Failed caption discovery | No explicit failure/absence distinction | Restricted/rate-limited/unknown state; existing formats retained |
| Both caption maps explicitly empty, no warnings | Empty list only | `none-confirmed`, displayed as “No captions were reported” |
| Manual and auto captions, including language variants | List without independent refresh | Manual preference, auto provenance and language variants retained; separate refresh and extraction |
| First analysis before runtime health/preview | Deno arguments could be absent | Deno initialized before extraction; regression checks the arguments |
| Screenshot video `jaKQMULU184` | User reported 360p | Live public extraction returned bot verification; no format/caption result available on this machine |
| Screenshot video `3tvpPHvfNbI` | User reported authentication error | Live public extraction returned bot verification; genuine upstream access restriction confirmed |

Live tests used the pinned official executable and Deno, public sessions, zero yt-dlp/extractor retries, a 10-second socket timeout and a process deadline. One permitted network extraction was made for each correctly transcribed screenshot ID. Both returned “Sign in to confirm … not a bot.” Initial sandbox attempts could not resolve YouTube DNS; an initially misread first ID was corrected before the permitted checks. No user's cookie file or account was inspected or tested. No aggressive repeated live requests were made.

**The maximum live resolution, accessible caption languages, and authenticated access for these two videos remain unverified.** The browser screenshot is not enough to establish whether higher formats require a PO token, account, region, or different upstream extraction. No 4K/1080p streams or captions have been fabricated.

## Extractor compatibility decisions

Pinned and executed yt-dlp: **2026.08.19**, matching the [official latest stable release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19) checked during this pass. Pinned and executed Deno: **2.9.4**, exceeding the documented 2.3.0 minimum. The official Windows yt-dlp executable includes EJS; no remote solver download was added. See the [official EJS setup documentation](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

Default supported extractor client selection is retained. No hardcoded `player_client`, invented PO token, or automatic plugin installation was added. `--ignore-config` prevents an unrelated machine configuration from silently changing the app's extraction/cookie behavior. The existing single public HLS fallback is retained for media HTTP 403; persistent denial becomes a format restriction instead of another automatic download cycle.

The [official PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) documents separate GVS/player/subtitle requirements and maintained provider interfaces. The featured bgutil and browser provider approaches were evaluated from that documentation. Neither was necessary to diagnose the observed bot-verification responses, and neither is installed. PO-token status is reported only when explicit extractor diagnostics support it; a generic 403 is not labeled a PO-token requirement. The application remains functional without a plugin.

## Captions, retry and credentials

Public extraction runs first. One authenticated fallback is allowed for a genuine sign-in requirement. HTTP 429 does not trigger an account test. Authentication/rate-limited analysis failures get a 60-second cooldown; independent caption refresh is deduplicated and cached for 60 seconds. Downloader/extractor retries are explicitly bounded.

Independent caption extraction uses `--skip-download --ignore-no-formats-error --sub-format vtt`, without a video format selector. Manual tracks use `--write-subs`; automatic tracks use `--write-auto-subs`. Caption failure never certifies a completed subtitle-bearing download. A missing selected caption cannot silently start a subtitle-free video.

Validation rejects missing/empty/header-only files, HTML responses, invalid UTF-8, invalid/backward cue clocks, and files without usable text cues. Multilingual UTF-8 is preserved. Failure/cancellation removes caption `.part` files and incomplete embedding outputs. Credential copies are removed independently of the media attempt directory.

Media downloads complete before captions are fetched. A successful yt-dlp exit creates an attempt-owned media receipt; subtitle-only retry checks that receipt, the owned file/size and ffprobe before reusing media. A playable header alone cannot certify a completed download. The existing error Retry control re-fetches/embeds captions without downloading the completed media again. Cancel/delete continues through DownloadManager's existing attempt cleanup.

## Conversion and player validation

Embedding uses video/audio copy with SRT in the MKV intermediate. Compatible MP4 output remuxes video/audio and converts subtitles to `mov_text`; WebM uses `webvtt` and its existing compatible-codec decisions. Incompatible output codecs can still require encoding, especially H.264 to WebM. Accurate Visual Trim also retains its existing encoding behavior. These cases are not described as lossless.

ffprobe now records width, height, codec, average/rational frame rate, audio presence and subtitle language/title metadata. Embedding and untrimmed requested-caption publication reject changed dimensions/FPS, lost audio or missing language-bearing captions. ISO 639-2 tags are used where MP4 requires them; original language variants are retained in title/handler metadata.

The real FFmpeg regression fixture is **1920×1080, 30 fps, H.264/AAC** with Arabic captions. MKV and MP4 retain the video/audio packet hashes; final MP4 exposes `mov_text`, MKV exposes SRT and WebM exposes WebVTT. Resolution and FPS remain 1080p/30. WebM's H.264-to-VP9 conversion is explicitly an encode.

The real Windows packaged smoke fixture contains embedded English/Arabic captions and an external French SRT. Chromium loads 1920×1080 video, selects each track, observes loaded and active cues after play/seek/pause, and turns captions off. Ten video, twenty audio and twenty Visual Trim cycles complete. Resource counts after closure: **0 streams, 0 FFmpeg processes, 0 probes, 0 sessions**. Cold start, corrupt-engine repair/restart and offline provisioned startup also pass.

Development diagnostics (`CORTEX_YOUTUBE_DEBUG=1` or development mode) include app/build and engine/runtime metadata, extraction mode, format counts/resolutions, caption counts, elapsed analysis time, error categories, conversion decision and output stream validation. Raw cookies, token values, signed CDN URLs and extractor command lines are not recorded by the new diagnostic paths.

## Verification

| Command | Result |
| --- | --- |
| `npm test` | 146 passed, 0 failed/skipped |
| `npm run test:unit` | 90 passed across four runs (31 + 12 + 26 + 21), 0 failed/skipped |
| `npm run test:integration` | 122 passed, 0 failed/skipped |
| Final changed-feature tests | 35 passed, 0 failed/skipped |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with zero warnings |
| `npm run build` | Passed; Windows unpacked app and NSIS candidate produced with publishing disabled |
| `npm run test:packaged` | Passed: cold start, corrupt-engine repair/restart, provisioned offline startup, 1080p captions and lifecycle checks |
| `git diff --check` | Passed |

The final focused run covers the last authentication-warning edge-case fix and generic-provider credential isolation added after the broader runs started. YouTube receives only an authorized cookie session; generic username/password settings remain available to their other providers. Tests use fake extractor responses/local fixtures; the media and packaged checks execute the actual Windows engines and Chromium. Initial sandbox-only runs could not access local HTTP fixtures/Windows cleanup consistently; the listed regression commands were rerun with the required Windows process, loopback and filesystem access.

Verification logs are kept under the ignored `app/smoke-results/` directory. Candidate artifacts remain under `app/release/2.2.0/`. Build and packaged validation are repeated after committing so the candidate manifest records the delivered branch commit.

## Exact changed files

The following source files implement the reliability pass (this report is also added):

- `app/Back-End/electron/analysisCoordinator.ts`
- `app/Back-End/electron/analysisProcess.ts`
- `app/Back-End/electron/captionDiscovery.ts`
- `app/Back-End/electron/commentsExtractor.ts`
- `app/Back-End/electron/cookieSession.ts`
- `app/Back-End/electron/cookieValidation.ts`
- `app/Back-End/electron/downloadManager.ts`
- `app/Back-End/electron/engines/YoutubeEngine.ts`
- `app/Back-End/electron/ipc/handlers.ts`
- `app/Back-End/electron/ipcSecurity.ts`
- `app/Back-End/electron/main.ts`
- `app/Back-End/electron/mediaFiles.ts`
- `app/Back-End/electron/mediaFormatRegistry.ts`
- `app/Back-End/electron/packagedSmoke.ts`
- `app/Back-End/electron/preload.ts`
- `app/Back-End/electron/youtubeAccess.ts`
- `app/Back-End/electron/youtubeDiagnostics.ts`
- `app/Back-End/electron/youtubeMediaCache.ts`
- `app/Back-End/electron/youtubeSubtitles.ts`
- `app/Back-End/electron/ytdlp.ts`
- `app/Front-End/src/App.tsx`
- `app/Front-End/src/actions/downloadActions.ts`
- `app/Front-End/src/components/AddDownloadTab.tsx`
- `app/Front-End/src/components/AddDownloadTab/UrlAnalysisView.tsx`
- `app/Front-End/src/components/AddDownloadTab/YouTubeStatus.tsx`
- `app/Front-End/src/components/MediaPlayer/PlayerControls.tsx`
- `app/Front-End/src/components/MediaPlayer/VideoPlayerView.tsx`
- `app/Front-End/src/components/SettingsTab.tsx`
- `app/Front-End/src/lib/downloadHelpers.ts`
- `app/Front-End/src/stores/useFormStore.ts`
- `app/Front-End/src/translations.ts`
- `app/Front-End/src/vite-env.d.ts`
- `app/Shared/types.ts`
- `app/Shared/youtubeErrors.ts`
- `app/package.json`
- `app/tests/downloadQuality.test.cjs`
- `app/tests/youtubeAccess.test.cjs`
- `app/tests/youtubeSubtitles.test.cjs`

No release was published, and master was not modified or force-pushed.
