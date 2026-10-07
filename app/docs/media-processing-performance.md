# Media processing

YouTube downloads preserve the selected resolution and frame rate. MP4 supports
VP9 as well as H.264, HEVC and AV1, so VP9 video is copied into MP4 without
encoding the video again. Incompatible audio such as Opus is converted to AAC.
Older players may not support VP9 in MP4; the extension does not imply H.264.

FFmpeg shares a two-to-four-thread budget between decoding and encoding, based
on half the available logical CPUs. Filters use one thread. These are thread limits, not a
guaranteed CPU utilization percentage, and concurrent tasks still add load.

Final validation probes the format and duration, scans every media packet with
errors treated as failures, and decodes two seconds at the start and end (when
duration is known and longer than four seconds). Publication still waits for all
checks and respects pause/cancel. This avoids decoding long videos end to end,
but does not detect every possible corrupt frame outside the sampled regions.

The conversion log distinguishes remuxing, audio-only encoding, video-only
encoding and full transcoding. Remuxing uses the merging UI phase.
