# Changelog

## 2.1.8

- Fetch and validate captions before downloading media, with one bounded authenticated caption retry when needed. Temporary cookie copies preserve the user's original export and are removed after use.
- Keep public video formats independent of caption authentication, preserving the highest available public quality.
- Embed captions without re-encoding audio or video, preserve them during final conversion, and reject final output when requested subtitles are missing.

## 2.1.7

- Analyze public YouTube videos without cookies first; use configured credentials only when sign-in is required.
- Retry public media HTTP 403 errors once with HLS while preserving the selected quality cap.
- Distinguish rate limiting from authentication failures and surface localized errors without silently omitting selected captions.

## 2.1.6

- Reset quality selection for each new URL while retaining choices made during analysis. Best Auto reflects the highest available resolution.
- Deliver download phase transitions immediately so queued progress cannot overwrite trimming updates.
- Validate installer upgrades against the package version and protect existing installations and profiles during validation.
- Verify packaged resources and third-party notices; publish the installer validated by the Windows release job.

These entries describe historical releases. Current subtitle generation and merging use the local subtitle workflow.
