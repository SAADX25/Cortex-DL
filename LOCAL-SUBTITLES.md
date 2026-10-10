# Local video subtitles

Open **Video subtitles / ترجمة الفيديو** in the sidebar, from a completed download, or from the analysis card's **Speech subtitles** button.
Caption failures in the downloads list also offer **Local speech subtitles** to open this workflow with the original public URL.

1. Choose a local video/audio file or enter a public URL supported by yt-dlp.
2. Select the spoken language (or automatic detection) and subtitle language.
3. Choose recognition and translation models, then download them once using **Prepare local models**.
4. Generate subtitles, review the original speech and translated text, and adjust individual cue times or the overall timing offset.
5. Save SRT or VTT. For local videos, preview the edited subtitles immediately or save a new MKV with a selectable subtitle track. The MKV copies the original encoded video/audio without recompression.

## Models and processing

| Option | Download | Purpose |
| --- | --- | --- |
| Whisper Large v3 | 3.10 GB | Higher accuracy recognition |
| Whisper Large v3 Turbo Q5 | 574 MB | Faster recognition |
| TranslateGemma 4B Q4 | 2.49 GB | Translation on ordinary desktop PCs |
| TranslateGemma 12B Q4 | 7.30 GB | Higher quality translation; requires at least 24 GB RAM |

Native engines and speech activity detection add approximately 29 MB. Downloads are optional, resumable, and verified against pinned SHA-256 hashes. Models live under the application's user-data directory, in `local-subtitles`. Translation models are subject to the [Gemma terms](https://ai.google.dev/gemma/terms).

After preparation, local file recognition and translation run on the computer without an API key. Downloading models and fetching public URLs need Internet access. Native processing currently uses CPU; processing time depends on the selected models, audio duration, and computer. Speech errors, dialect ambiguity and translation mistakes remain possible. Highlighted cues need review; other cues should also be checked before publication.

Timing comes from the recognizer's audio offsets and is preserved during translation, including gaps in speech. Exports reject invalid or overlapping timing. Cancel stops native processes before temporary files are removed. If translation fails, completed original-language captions remain available and retrying can reuse recognition within the current app session.

## Legacy cleanup and retained tools

The YouTube cookies file selector, validation/session fallback, obsolete authentication IPC and unused prototype downloader were removed. Startup removes the obsolete cookies path setting, without deleting any user-owned cookies file. Public analysis, native public captions, downloads, updates, engine repair, readiness checks, diagnostics and logs remain available. Restricted videos require a readable local file for this workflow.

## Verification

- A real English speech fixture was recognized by Whisper Turbo, translated to Arabic by TranslateGemma 4B, and exported as timed SRT.
- Native FFmpeg testing verified Arabic subtitle embedding and identical encoded audio/video stream hashes, resolution and FPS.
- Automated tests cover timing, validation, model integrity/resume, cancellation, translation failures and preserved original captions.
- The higher accuracy recognition model and 12B translator share the pipeline but were not downloaded for this validation.
