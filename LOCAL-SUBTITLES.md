# Local video subtitles

Open **Video subtitles / ترجمة الفيديو** in the sidebar or from a completed download's **Subtitles** button.

1. Choose a local video/audio file or enter a public URL supported by yt-dlp.
2. Select the spoken language (or automatic detection) and subtitle language.
3. Choose recognition and translation models, then download them once using **Prepare local models**.
4. For songs choose **Audio content → Music and singing / نوع الصوت → موسيقى وغناء**. This processes the full audio without the dialogue activity filter and takes longer. Generate subtitles, review the original speech and translated text, and adjust individual cue times or the overall timing offset.
5. Save SRT or VTT. For local videos, preview the edited subtitles immediately or save a new MKV with a selectable subtitle track. The MKV copies the original encoded video/audio without recompression.

Completed video downloads show **Merge subtitles / دمج الترجمة** when a matching timed SRT or VTT is present beside the video (for example, `video.mp4` and `video.ar.srt`). Choose a subtitle and save a separate MP4, or select MKV. Original audio/video packets and existing subtitle tracks are retained; the added track is selected by default. MP4 uses `mov_text` subtitles and MKV uses SubRip. A player must support selectable subtitles to display the track. The original video and subtitle files remain untouched. Discovery refreshes when the app regains focus or a subtitle is exported, and merging can be canceled.

## Models and processing

| Option | Download | Purpose |
| --- | --- | --- |
| Whisper Large v3 | 3.10 GB | Higher accuracy recognition |
| Whisper Large v3 Turbo Q5 | 574 MB | Faster recognition |
| TranslateGemma 4B Q4 | 2.49 GB | Translation on ordinary desktop PCs |
| TranslateGemma 12B Q4 | 7.30 GB | Higher quality translation; requires at least 24 GB RAM |

Native engines and speech activity detection add approximately 29 MB. Downloads are optional, resumable, and verified against pinned SHA-256 hashes. Models live under the application's user-data directory, in `local-subtitles`. Translation models are subject to the [Gemma terms](https://ai.google.dev/gemma/terms).

After preparation, local file recognition and translation run on the computer without an API key. Downloading models and fetching public URLs need Internet access. Automatic processing uses a compatible NVIDIA GPU when its optional engines are prepared; CPU remains available. The operation panel shows the backend actually used for each stage. Processing time depends on the selected models, audio duration, and computer. Speech errors, dialect ambiguity and translation mistakes remain possible. Highlighted cues need review; other cues should also be checked before publication.

## GPU acceleration

Select **Processing device → Automatic / جهاز المعالجة → تلقائي**. **Prepare GPU engines** downloads verified Whisper CUDA 11.8, its NVIDIA cuBLAS dependencies, and llama.cpp Vulkan. No CUDA toolkit installation is needed. The initial GPU engine download is approximately 739 MB, and extracted engines need approximately 1.4 GB. CUDA support is selected conservatively for NVIDIA compute capability 5.2–9.0 with at least 2 GB total VRAM; recognition requires at least 2 GB free. The current packaged recognition acceleration path targets NVIDIA on Windows x64.

GPU recognition with Large v3 uses the pinned Q5 version (1.08 GB) to reduce VRAM use; accuracy can differ slightly from the original full-precision model. If Large v3 is already installed, the application derives Q5 locally and verifies it against the official model checksum instead of downloading the weights again. CPU mode preserves the original model. Translation selects the matching NVIDIA Vulkan device, offloads as many layers as the available VRAM budget allows, and reserves memory for display, cache and working buffers. Failed GPU startup falls back to CPU; canceling does not start a fallback job. Missing GPU support does not prevent CPU processing.

On the user's GTX 1050 Ti 4 GB, real CUDA recognition of a 30-second song excerpt took approximately 31 seconds versus 59 seconds with the original CPU model. The full recognition plus Arabic translation pipeline completed in approximately 38 seconds versus 93 seconds previously. These are excerpt measurements, not full-video time guarantees; the GPU run uses Q5 recognition weights.

Timing comes from the recognizer's audio offsets and is preserved during translation, including gaps in speech. Exports reject invalid or overlapping timing. Cancel stops native processes before temporary files are removed. If translation fails, completed original-language captions remain available and retrying can reuse recognition within the current app session.

Dialogue mode retries once with the full audio if recognition returns only non-verbal events such as `♪` or `[Music]`, or no words. Non-verbal-only output is never sent to translation or presented as a completed subtitle document. Singing mode and dialogue mode use separate recognition cache keys. Singing recognition can still mishear lyrics; review the text and timing.

## Session privacy and player controls

Subtitle results and the recognition retry cache exist only in process memory; they are not saved as subtitle history. **Clear session / مسح جلسة الترجمة** discards both, resets review edits/timing and the selected source, and closes any generated subtitle preview. Saved SRT/VTT files, subtitled videos, source media and downloaded models remain on disk. Clearing is disabled during processing; cancel first. A stale session cannot clear a newer job, and a save already in progress cannot restore a cleared result.

Closing the window hides Cortex DL in the system tray. **Quit / Exit** from the tray fully exits, waits for native subtitle processes to stop, and clears session memory. Temporary recognition files are removed after processing or cancellation.

The player's CC button opens a language menu with readable language names, an off option, and a selected-track checkmark. It supports arrow keys, Home/End, Enter/Space, Escape and outside-click dismissal. Escape dismisses the menu without closing the player. The controls remain visible while the menu is open.

## Legacy cleanup and retained tools

The YouTube cookies selector, online caption discovery/download/embedding, caption retry cache, obsolete authentication IPC and unused prototype downloader were removed. Startup removes retired caption options from download history and the obsolete cookies setting, without deleting user-owned media or subtitle files. Public analysis, downloads, updates, engine repair, readiness checks, diagnostics and logs remain available. Subtitle creation now uses the local speech system; embedding uses the local subtitle workflow or the completed download's merge button. YouTube can still reject public URL analysis with bot verification or viewing-permission checks; those failures are reported separately from subtitle processing.

Rejected analysis has a short cooldown shared across equivalent YouTube watch, Shorts and share URLs. The IPC handler checks it before fetching optional title metadata, and aborts optional requests when analysis fails. This prevents repeated requests from the app; it does not clear a verification requirement imposed by YouTube. On the current device, a direct native audit confirmed Deno 2.9.4, EJS 0.8.0 and yt-dlp 2026.08.19 were available, while both the requested video and a separate public video were rejected before format discovery. Testing alternate supported clients and Chrome request impersonation also failed; these unproven overrides were not added to the production pipeline.

## Verification

- A real English speech fixture was recognized by Whisper Turbo, translated to Arabic by TranslateGemma 4B, and exported as timed SRT.
- Native FFmpeg testing verified Arabic subtitle embedding and identical encoded audio/video stream hashes, resolution and FPS.
- Automated tests cover timing, validation, model integrity/resume, cancellation, translation failures and preserved original captions.
- The user's installed Large v3 and 4B models were also verified on real English speech. The 12B translator was not downloaded for validation.
