# Cortex-DL URL analysis and performance pass

Base: Update-87 (`28f883153a138f245df9c1d4ce967cff28237974`). The remote master was checked and matches this base. Branch: `codex/progressive-url-analysis`.

1. **Bottlenecks found.** Primary extraction awaited Return YouTube Dislike; concurrent duplicates spawned separate extractors; the renderer accepted stale completions/errors; old analyses survived input changes; the thumbnail proxy buffered entire responses and wrote synchronously; production logging ran for every stdout chunk. Metadata extraction had no overall deadline/output bound, cookies were rescanned, yt-dlp caching was disabled, and the download engine always performed a separate metadata prefetch.

2. **Previous flow.** URL input → IPC → HLS detection → complete yt-dlp JSON → format/subtitle processing → await RYD → renderer → remote/proxied image. Optional services and full extraction preceded the first usable result. Download then prefetched metadata again.

3. **New flow.** Normalize input and validate provider locally → immediately publish a YouTube preview/thumbnail URL → fetch a cheap oEmbed title independently → run bounded shared full extraction → publish compact formats/metadata → enrich dislikes independently. Direct media candidates get a bounded HEAD check; M3U8 uses the existing HLS parser with a bounded body/deadline; other supported providers retain yt-dlp. No extraction path invokes FFmpeg.

4. **Fast preview.** The renderer holds the normalized stable source URL. A valid YouTube video ID supplies provider identification, video indication and `hqdefault.jpg` immediately, with a temporary provider title. A cheap oEmbed response updates the actual title while extraction continues. Playlist links retain the existing playlist/single-video choice and flat extraction. Duration appears when yt-dlp supplies it; it is not fabricated.

5. **Asynchronous details.** Formats, resolution, FPS, video/audio codecs, filesize estimates, duration, subtitle language summaries, views and likes arrive with full extraction. Optional dislikes arrive separately. A failed oEmbed/CDN/RYD request does not fail primary analysis. Downloads can proceed with the stable source URL while preview metadata is loading; missing download metadata keeps the existing prefetch path.

6. **Stale writes.** A renderer generation owns the result, error, analyzing flag and event subscription. Each IPC request has a UUID. Event updates require both the matching UUID and current generation. Late preview titles cannot replace the full title; enrichment received before the full reply is retained safely. Input editing, clearing, URL replacement and view disposal invalidate ownership. SmartImage also tracks source ownership for late proxy results.

7. **Cancellation.** IPC owns a controller per sender/request; renderer cancellation and sender destruction abort it. Shared work has separate analysis ownership, never download ownership. The final consumer aborts the extraction controller; process-tree termination kills yt-dlp and its children. stdout/stderr continue draining within limits until close. The concurrency slot and work entry retire after teardown. Each sender has a single destruction listener even for a large queued batch. Cancellation cannot update the current UI with an error.

8. **In-flight sharing.** AnalysisCoordinator keys work by normalized URL plus cookie-file identity. Identical callers share extraction, with independent subscriber cancellation. The last subscriber cancels underlying work. Failed/finished jobs leave the registry; cancelled queued work never spawns. A semaphore caps extraction at three processes, independently of download concurrency. Repeated identical primary requests keep the current analysis.

9. **Metadata cache.** Five-minute absolute TTL, 50-entry LRU behavior, copy isolation, and no successful caching of unknown/failed/authentication/rate-limit results. Safe YouTube aliases canonicalize only when query parameters are recognized as presentation parameters. Playlist, identity and unknown/authentication parameters are preserved; arbitrary trailing path slashes are preserved. Cookie path/mtime/ctime/size scope prevents mixing authenticated analyses. Cached format lists exclude signed media URLs; fresh extraction retains the existing Visual Trim fallback URLs.

10. **Thumbnail fast path.** Exact YouTube host matching supports watch, youtu.be, Shorts, embed and live video links. IDs must match the eleven-character alphabet; invalid or lookalike hosts do not receive invented thumbnails. The full yt-dlp thumbnail replaces the early CDN choice. The main preview uses eager loading, high fetch priority and asynchronous decoding; list thumbnails remain lazy. SmartImage forwards fetch priority as the native lowercase attribute for React 18 compatibility.

11. **Thumbnail memory/cache.** Remote response streams through a byte-counting transform to an asynchronous temporary file, followed by atomic rename. There is a ten-second overall deadline, eight-MiB limit, allowed image Content-Type list, bounded signature/trailer checks, SHA-256 filenames, completed-cache lookup before HTTP, and in-flight deduplication. Partial/malformed files are removed; corrupt cached files are fetched again. Instagram/Facebook CDN proxying occurs only after direct browser loading fails. Cache pruning runs at most hourly, targets seven-day age and 128 MiB, recognizes legacy cache filenames, and skips active downloads.

12. **Optional metadata.** RYD is preserved as background enrichment after full metadata, with a two-second deadline and request ownership. It does not delay title, thumbnail or formats. oEmbed has a three-second deadline. JSON response helpers cap bodies at two MiB and include stalled-body time in the deadline. HLS caps manifests at four MiB with a ten-second deadline; HEAD probes have a three-second deadline. Fetch/body readers, timers and abort listeners are cleaned up.

13. **Cookie validation.** Settings, analysis, preview, comments and downloads share asynchronous validation. One stat establishes identity; unchanged files avoid reads/scans. Cache keys use resolved path, mtime, ctime and size, with bounded entries and shared pending validation. Invalid results invalidate when files change; deletion clears them. Files above eight MiB are rejected. Only validation metadata is retained; cookie contents/values are neither cached nor logged.

14. **CPU decisions.** The existing media-format registry now exposes one decision: direct, remux, audio encode, video encode or full transcode. Download prefetch is skipped when an existing title and thumbnail provide the needed descriptive metadata; stream progress still learns actual sizes from yt-dlp. Download execution resolves fresh media from the stable webpage URL and selected format ID. DirectEngine is unchanged. No GPU encoding was introduced.

15. **Stream copy cases.** Compatible H.264/AAC to MP4 and compatible codec/container changes use stream copy/remux. Compatible audio can be extracted from a video without audio re-encoding. If only audio is incompatible, video is copied; if only video is incompatible, audio is copied. Existing yt-dlp merger copy arguments and final output validation remain in force.

16. **Encoding cases.** Accurate trim still encodes. Incompatible streams, unknown/unprobed sources and GIF output retain the necessary encoders. Subtitle processing keeps the existing container rules. The change does not substitute inaccurate keyframe cuts or skip codec/container/output validation.

17. **Tests added.** Twelve deterministic tests cover safe normalization, stale result/error/enrichment protection, independent cancellation, actual child teardown/deadlines/output bounds/UTF-8, last-consumer teardown before queued work starts, in-flight dedup, completed cache/TTL/LRU, bounded batch concurrency, direct HEAD routing, optional stalled/oversized JSON, eager thumbnail configuration, bounded/deduplicated/typed thumbnail streams and corrupt-cache recovery, cookie change/deletion, stream-copy decisions, and real IPC behavior with fake yt-dlp/optional APIs. Playlist flatness and no FFmpeg analysis are asserted. Unit/integration scripts include the new tests. Tests use local HTTP/fake extraction, never live YouTube.

18. **Measurements.** `node scripts/benchmark-analysis.cjs` compares the exact Update-87 source with the updated analyzer using a real Node child as a fake extractor (20 ms deliberate extraction delay) and a mocked optional service (250 ms deliberate delay). Each path has one discarded warmup and five measured samples. These measurements isolate optional-service waiting and process sharing, not real provider/network performance.

| Measurement | Update-87 | Updated |
| --- | ---: | ---: |
| Mean primary result | 407.19 ms | 144.82 ms |
| Five primary samples | [405.18, 422.5, 394.64, 406.59, 407.02] | [142.93, 156.93, 142.23, 142.3, 139.72] |

Updated simultaneous equivalent links: 127.82 ms, 1 extractor. Completed metadata cache: 0.3 ms. No claim of instant live analysis or zero CPU.

19. **Final verification.** Commands run from `G:/Cortex DL/app`. Existing coverage includes real codec/container conversion, accurate trimming, 20/25-cycle Visual Trim/media lifecycle cleanup, pause/resume, SQLite recovery and Direct Range fallback. Final command results:

| Command | Exit | Result | Elapsed |
| --- | ---: | --- | ---: |
| `npm test` | 0 | 56 passed | 264.45 s |
| `npm run test:unit` | 0 | 30 passed | 5.25 s |
| `npm run test:integration` | 0 | 56 passed | 257.64 s |
| `npm run typecheck` | 0 | Passed | 8.65 s |
| `npm run lint` | 0 | Passed | 7.61 s |
| `npm run build` | 0 | Passed | 79.7 s |
| `git diff --check` | 0 | Passed | — s |
| `node --test tests/analysisPerformance.test.cjs` (latest focused recheck) | 0 | 12 passed | 4.98 s |

20. **Exact files changed.** Generated release/dist/dist-electron outputs, log files, benchmark output JSON, binaries, thumbnails and runtime media fixtures are excluded from the commit.

- `app/Back-End/electron/analysisCoordinator.ts`
- `app/Back-End/electron/analysisNetwork.ts`
- `app/Back-End/electron/analysisProcess.ts`
- `app/Back-End/electron/analysisTiming.ts`
- `app/Back-End/electron/commentsExtractor.ts`
- `app/Back-End/electron/cookieValidation.ts`
- `app/Back-End/electron/directAnalysis.ts`
- `app/Back-End/electron/engines/YoutubeEngine.ts`
- `app/Back-End/electron/hls.ts`
- `app/Back-End/electron/ipc/handlers.ts`
- `app/Back-End/electron/mediaFormatRegistry.ts`
- `app/Back-End/electron/preload.ts`
- `app/Back-End/electron/thumbnailCache.ts`
- `app/Back-End/electron/ytdlp.ts`
- `app/Back-End/electron/ytdlpCache.ts`
- `app/Front-End/src/actions/downloadActions.ts`
- `app/Front-End/src/components/AddDownloadTab.tsx`
- `app/Front-End/src/components/AddDownloadTab/UrlAnalysisView.tsx`
- `app/Front-End/src/components/SmartImage.tsx`
- `app/Front-End/src/components/UrlInputBar.tsx`
- `app/Front-End/src/lib/analysisSession.ts`
- `app/Front-End/src/stores/useUIStore.ts`
- `app/Front-End/src/vite-env.d.ts`
- `app/Shared/analysisUrl.ts`
- `app/Shared/types.ts`
- `app/docs/analysis-performance.md`
- `app/package.json`
- `app/scripts/benchmark-analysis.cjs`
- `app/tests/analysisPerformance.test.cjs`

21. **Limits and targets.** The full formats/title extraction still depends on provider latency, authentication and yt-dlp startup. The cheap title route currently targets unambiguous YouTube videos; other providers get their normal extractor result. oEmbed may fail for private or unavailable videos, leaving the provider placeholder until extraction resolves. There is no live-provider speed or CPU utilization claim. Cache benefits from enabling yt-dlp's persistent cache were not isolated on live YouTube. The isolated yt-dlp cache is pruned at most hourly toward 30-day/64-MiB limits; recent files are protected, so storage limits are maintenance targets rather than instantaneous quotas. Image checks catch malformed/truncated headers and trailers, not every possible decoder defect. Metadata stdout is bounded at 32 MiB with a 90-second overall extraction deadline; unusually large valid playlists may report a size error rather than parse truncated JSON. Standard quality choices already group by height/FPS; all raw format IDs remain available for Advanced selection. Performance targets are immediate input feedback, early independent thumbnail/title, immediate warm metadata cache, one shared duplicate extraction, bounded work, and cancellation after ownership changes, without flaky millisecond assertions. Development diagnostics are explicitly enabled with `CORTEX_ANALYSIS_DEBUG=1`, logging normalization, provider detection, process startup/extraction, JSON parse, preview render, image availability and full-format readiness without URL/cookie values.

22. **Preservation.** No UI redesign, yt-dlp/FFmpeg replacement, unrelated feature refactor, downloader ownership change or GPU introduction. Visual Trim remains lazy and requests a fresh preview only when opened; its existing lifecycle, fallback, trim accuracy and output validation remain. Audio finalization, pause/resume, Direct Range behavior and validated publication retain their existing reliability tests. This pass changes only the analysis/thumbnail/cookie paths, relevant download prefetch/codec decisions, diagnostic tooling and tests.
