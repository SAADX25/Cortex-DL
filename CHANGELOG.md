# Changelog

Released installers are listed on [GitHub Releases](https://github.com/SAADX25/Cortex-DL/releases). Unreleased changes are not a new application version.

## Unreleased

- Show animated analysis stages while video details and qualities load, in English and Arabic.
- Restore missing engines using a pinned FFmpeg release and clearer setup controls and errors.
- Protect release tags from reuse or movement, with local Git guards and CI checks.
- Shorten the documentation and add a feature-to-file code map.

## 2.2.0

- Add a local subtitle workspace for generation, translation, review and export.
- Expand the media library, cover editing and floating playback.
- Improve startup readiness, engine verification and download cancellation.
- Strengthen Windows installer and release validation.

## 2.1.8

- Fetch and validate captions before media downloads, with one bounded authenticated retry when needed.
- Keep public video quality independent of caption authentication.
- Preserve requested captions during conversion and reject outputs missing them.

## 2.1.7

- Analyze public YouTube videos without cookies first.
- Retry public media HTTP 403 errors once with HLS, preserving the quality cap.
- Distinguish rate limits from authentication failures and report caption errors clearly.

## 2.1.6

- Reset quality for each new URL while retaining choices made during analysis.
- Deliver download phase changes without stale progress overwriting them.
- Validate installer upgrades while protecting existing profiles and installations.
- Verify packaged resources and notices, and publish the installer that passed validation.

Earlier entries describe behavior at release time. Current subtitle generation and merging use the local subtitle workflow.
