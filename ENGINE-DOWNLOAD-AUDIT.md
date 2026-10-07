# Engine download audit — 2026-10-07

## Findings

- The current Windows installer excludes engine binaries. First launch downloads pinned yt-dlp, FFmpeg and Deno packages sequentially. Healthy engines are reused on later launches.
- FFmpeg's pinned archive is 200,211,027 bytes (about 191 MiB). Large first-run transfers can legitimately take several minutes.
- The downloader previously aborted each attempt after 180 seconds, deleted its partial file and restarted from zero, up to three attempts. This can repeatedly discard a healthy but slow FFmpeg download.
- GitHub throughput varied across samples: about 140 KiB/s to 1.2 MiB/s for yt-dlp. All three package URLs returned HTTP 206 for 1 MiB range probes. This establishes current availability, not historical throughput during the attached screenshot.
- A complete download through the application's downloader retrieved yt-dlp's 17,840,399 bytes in 103,696 ms. Its pinned SHA-256 and executable version both passed verification.
- The screenshot's 47% is overall setup progress; 9.6/17.0 MB is progress for the current package.

## Changes

- Replaced the three-minute transfer deadline with a 60-second inactivity timeout and a 30-minute maximum per attempt. Active slow downloads can continue; stalled connections remain bounded.
- Added average download speed and estimated remaining time to setup status, plus download start/completion timing in logs.
- Added a regression exercising a slow active body and stalled bodies, including retry resource cleanup.
- Corrected README's obsolete statement that the installer bundles engines.

Interrupted downloads still restart from zero; cross-attempt or cross-launch partial resume was not added.

## Validation

- TypeScript, ESLint and Vite production builds passed.
- All four local baseline engines passed checksum/version/execution verification in 3,955 ms.
- Full existing suite: 76/77 initially passed. The sole failure was Windows denying sandboxed Electron access to its installation directory. Re-running that exact Electron playback test outside the tool sandbox passed, including 26 player sessions. No system ACL changes were made.
- New timeout regression passed. Targeted timeout/setup/hardening run: 16/16 passed.
- Compiled development startup probe with external network disabled reached `ready` in 5,265 ms. Media server, engine checks, backend initialization and shutdown completed successfully. Evidence: `app/.cortex_temp/engine-startup-audit/startup-timing.json` and its logs.

These results cover the checked source and local development engines. No new installer was produced, and the original screenshot's runtime logs were not available. Existing installer artifacts do not include this change until rebuilt.
