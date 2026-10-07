# Cortex DL 2.1.7

Public YouTube videos now use public extraction first for analysis, downloads and
previews. A configured cookies file is tried once only when YouTube explicitly
requires sign-in. Other providers retain their configured cookies behavior.

This fixes a reproduced quality regression: the reported video exposed 1080p
without cookies, while the configured account session exposed only 360p. The
corrected application analysis exposes 1080p even with a cookies file configured.
Best Auto and explicit quality selections retain the existing format selectors.

When a public media URL returns HTTP 403, the download engine tries HLS formats
once, keeping the quality cap and subtitle selection. A live HLS download of the
reported video was verified with ffprobe as 1080p H.264 video with AAC audio.
Authentication and subtitle errors do not trigger this media fallback.

HTTP 429 is classified separately from sign-in failures. Arabic and English
messages distinguish subtitle throttling from general request throttling. A 429
does not trigger an authenticated retry or automatic task retries. Selected
subtitles are not silently removed to make a download succeed.

Live Arabic automatic-subtitle extraction for the reported video still returned
HTTP 429 from YouTube during validation. This release corrects the application
behavior and diagnosis; it does not guarantee that YouTube will lift its limit.
Wait before retrying, or explicitly select no subtitles to download video alone.

Regression coverage exercises public quality with configured synthetic cookies,
real sign-in fallback, cancellation, bounded failures, preview consistency,
subtitle preservation and localized error messages. The release workflow also
runs the complete regression suite, packaged smoke, installer and artifact checks
before publishing its validated installer.

The Windows x64 installer is unsigned. Verified media engines are downloaded on
first launch. Existing settings and downloads are preserved by the installer.
