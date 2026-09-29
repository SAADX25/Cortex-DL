# Media player lifecycle diagnostics

In a development build, open the renderer DevTools console and run:

```js
await window.__cortexMediaDiagnostics()
```

For a packaged build, start Cortex DL with `CORTEX_DL_MEDIA_DIAGNOSTICS=1` in its environment before opening DevTools. The helper returns `null` in an ordinary packaged run. Process metrics come from Electron's `app.getAppMetrics()` and `process.getProcessMemoryInfo()`; the stream and process counts come from the local media server. The renderer counts active player sessions and `AudioContext` objects. No media path or capability token is included.

Record snapshots at idle, after opening and playing a video, after closing it, after a second video cycle, and after opening and closing audio. Repeat a 1080p video ten times, a 4K video ten times, and audio twenty times when fixtures and a desktop session are available. After each close, confirm `requests.streams`, `requests.ffmpegProcesses`, `requests.probeProcesses`, `renderer.sessions`, and `renderer.audioContexts` settle at zero. A few process-memory snapshots are insufficient to identify a leak: compare repeated cycles while accounting for Chromium allocator and GPU caches.
