# Cortex DL 2.1.8

YouTube captions are fetched and validated separately before downloading media.
If a public subtitle request needs sign-in or returns subtitle HTTP 429, one
attempt can use the configured cookies file for captions alone. A temporary copy
protects the original export from yt-dlp cookie-jar writes and is removed on
success, failure or cancellation. Valid owned VTT files can be reused on resume.

Video downloads continue to use public formats first, with the bounded public
HLS fallback for media HTTP 403. Subtitle authentication does not select account
video formats or impose the previously reproduced 360p limit.

The selected captions are merged into an intermediate MKV without recoding video
or audio. Final MP4/MKV/WebM output retains captions, and the manager refuses to
publish Completed when the requested embedded subtitle stream is absent. Missing,
empty or invalid caption files fail visibly instead of certifying video alone.

Local regression validation includes synthetic credentials, original-cookie
preservation, bounded retries, cleanup, cancellation, resume, real FFmpeg subtitle
embedding, identical audio/video packet hashes, MP4/WebM caption retention and
rejection of missing subtitles at finalization.

Live validation downloaded the reported video's Arabic automatic captions using
the configured account cookies after public caption requests returned HTTP 429.
The application merge and finalization pipeline combined those real captions
with the verified public 1080p video. The final MP4 contains H.264 1080p video,
AAC audio and a mov_text subtitle stream with 116 Arabic cues. Encoded video and
audio packet hashes match the original media, confirming no quality loss from
caption embedding. The temporary cookies copy was removed after the request.

This fixes the reproduced account/session case. YouTube can still reject expired
sessions or throttle caption requests; failures remain visible and selected
captions are never silently omitted. No PO-token provider is bundled.
