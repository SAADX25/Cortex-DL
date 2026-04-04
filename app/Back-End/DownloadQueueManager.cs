using System;
using System.Buffers;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

/// <summary>
/// A robust download queue manager for sequential (or limited concurrent) downloads.
/// - Shared HttpClient
/// - System.Threading.Channels for zero-CPU idling
/// - Safe dynamic concurrency controls
/// - IProgress<DownloadProgress> for UI-safe progress reporting
/// - Cancellation + Pause/Resume support
/// </summary>
public class DownloadQueueManager
{
    private static readonly HttpClient _httpClient = new HttpClient();

    private class DownloadRequest
    {
        public string Url { get; }
        public IProgress<DownloadProgress> Progress { get; }
        public DownloadRequest(string url, IProgress<DownloadProgress> progress)
        {
            Url = url;
            Progress = progress;
        }
    }

    private readonly Channel<DownloadRequest> _channel;
    private int _maxConcurrency;
    private readonly SemaphoreSlim _concurrencySemaphore;
    private readonly object _concurrencyLock = new object();
    
    private CancellationTokenSource _cts = new CancellationTokenSource();
    private readonly string _destinationFolder;

    private Task _processingTask;

    // Pause/Resume support (async-friendly)
    private volatile bool _isPaused;
    private TaskCompletionSource<bool> _pauseTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>
    /// Create a new DownloadQueueManager.
    /// </summary>
    /// <param name="destinationFolder">Folder where files are saved. Will be created if missing.</param>
    /// <param name="maxConcurrency">Maximum simultaneous downloads. Default 1 (sequential).</param>
    public DownloadQueueManager(string destinationFolder, int maxConcurrency = 1)
    {
        if (maxConcurrency < 1) throw new ArgumentOutOfRangeException(nameof(maxConcurrency));
        _destinationFolder = destinationFolder ?? throw new ArgumentNullException(nameof(destinationFolder));
        Directory.CreateDirectory(_destinationFolder);
        
        _channel = Channel.CreateUnbounded<DownloadRequest>(new UnboundedChannelOptions 
        { 
            SingleReader = true 
        });
        
        _maxConcurrency = maxConcurrency;
        // By setting maxCount to Int32.MaxValue, we can safely increase concurrency dynamically via SetMaxConcurrency
        _concurrencySemaphore = new SemaphoreSlim(maxConcurrency, int.MaxValue);
        
        // Ensure pause starts in non-paused state
        _pauseTcs.TrySetResult(true);
    }

    /// <summary>
    /// Represents progress information reported back to UI.
    /// </summary>
    public class DownloadProgress
    {
        public string FileName { get; }
        public double Percentage { get; }
        public double SpeedBytesPerSecond { get; }
        public long BytesReceived { get; }
        public long? TotalBytes { get; }

        public DownloadProgress(string fileName, double percentage, double speedBytesPerSecond, long bytesReceived, long? totalBytes)
        {
            FileName = fileName;
            Percentage = percentage;
            SpeedBytesPerSecond = speedBytesPerSecond;
            BytesReceived = bytesReceived;
            TotalBytes = totalBytes;
        }
    }

    /// <summary>
    /// Enqueue a URL for download without custom progress reporting.
    /// </summary>
    public void Enqueue(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) throw new ArgumentNullException(nameof(url));
        _channel.Writer.TryWrite(new DownloadRequest(url, null));
        EnsureProcessing();
    }

    /// <summary>
    /// Enqueue a URL and start downloading with dedicated progress reporting. (No underlying dropping of items).
    /// </summary>
    public void EnqueueAndStart(string url, IProgress<DownloadProgress> progress = null)
    {
        if (string.IsNullOrWhiteSpace(url)) throw new ArgumentNullException(nameof(url));
        // Pack the URL along with the requested Progress. The consumer loop safely processes it.
        _channel.Writer.TryWrite(new DownloadRequest(url, progress));
        EnsureProcessing();
    }

    /// <summary>
    /// Starts processing the queue if not already running.
    /// </summary>
    public void Start() => EnsureProcessing();

    private void EnsureProcessing()
    {
        if (_processingTask == null || _processingTask.IsCompleted)
        {
            if (_cts.IsCancellationRequested)
            {
                _cts.Dispose();
                _cts = new CancellationTokenSource();
            }
            _processingTask = Task.Run(() => ProcessingLoopAsync(_cts.Token));
        }
    }

    /// <summary>
    /// Pause the queue (in-progress downloads continue; new downloads wait until Resume).
    /// </summary>
    public void Pause()
    {
        if (_isPaused) return;
        _isPaused = true;
        _pauseTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    /// <summary>
    /// Resume the queue.
    /// </summary>
    public void Resume()
    {
        if (!_isPaused) return;
        _isPaused = false;
        _pauseTcs.TrySetResult(true);
    }

    /// <summary>
    /// Stop processing and cancel all pending work.
    /// </summary>
    public void Stop()
    {
        try
        {
            _cts?.Cancel();
        }
        catch { }
    }

    /// <summary>
    /// Updates the maximum concurrency at runtime safely avoiding exceptions.
    /// </summary>
    public void SetMaxConcurrency(int newConcurrency)
    {
        if (newConcurrency < 1) throw new ArgumentOutOfRangeException(nameof(newConcurrency));
        
        lock (_concurrencyLock)
        {
            if (newConcurrency > _maxConcurrency)
            {
                // Release extra permits to increase concurrency allowed
                _concurrencySemaphore.Release(newConcurrency - _maxConcurrency);
            }
            else if (newConcurrency < _maxConcurrency)
            {
                // To safely decrease limit without disposing an active semaphore, we issue
                // dummy wait tasks. They will silently eat tokens as active downloads finish.
                int tokensToRemove = _maxConcurrency - newConcurrency;
                for (int i = 0; i < tokensToRemove; i++)
                {
                    _ = ConsumeTokenAsync(_cts.Token);
                }
            }
            _maxConcurrency = newConcurrency;
        }
    }

    private async Task ConsumeTokenAsync(CancellationToken ct)
    {
        try
        {
            await _concurrencySemaphore.WaitAsync(ct).ConfigureAwait(false);
        }
        catch { /* ignored if cancellation kicks in */ }
    }

    private async Task ProcessingLoopAsync(CancellationToken token)
    {
        try
        {
            // Threading.Channels acts as an ideal producer-consumer queue without CPU busy-waiting
            await foreach (var request in _channel.Reader.ReadAllAsync(token).ConfigureAwait(false))
            {
                // Wait for resume if paused
                await _pauseTcs.Task.ConfigureAwait(false);

                // Respect concurrency via semaphore
                await _concurrencySemaphore.WaitAsync(token).ConfigureAwait(false);

                // Start the download on background without awaiting so more items can loop
                _ = Task.Run(async () =>
                {
                    try
                    {
                        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
                        await DownloadFileAsync(request.Url, linkedCts.Token, request.Progress).ConfigureAwait(false);
                    }
                    catch { }
                    finally { _concurrencySemaphore.Release(); }
                }, token);
            }
        }
        catch (OperationCanceledException) { }
    }

    /// <summary>
    /// Core download operation that supports progress reporting.
    /// </summary>
    private async Task DownloadFileAsync(string url, CancellationToken ct, IProgress<DownloadProgress> progress)
    {
        var sw = Stopwatch.StartNew();
        long totalBytes = -1;
        long received = 0;

        using var response = await _httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        totalBytes = response.Content.Headers.ContentLength ?? -1;

        var fileName = GetSafeFileNameFromUrl(url, response) ?? Guid.NewGuid().ToString();
        var filePath = Path.Combine(_destinationFolder, fileName);

        await using (var contentStream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false))
        await using (var fileStream = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
        {
            var buffer = ArrayPool<byte>.Shared.Rent(81920);
            try
            {
                int read;
                while ((read = await contentStream.ReadAsync(buffer, 0, buffer.Length, ct).ConfigureAwait(false)) > 0)
                {
                    await fileStream.WriteAsync(buffer, 0, read, ct).ConfigureAwait(false);
                    received += read;

                    // compute average speed
                    var elapsed = sw.Elapsed.TotalSeconds;
                    var speed = elapsed > 0 ? received / elapsed : 0.0;
                    double percentage = -1;
                    if (totalBytes > 0) percentage = Math.Min(100.0, (received * 100.0) / totalBytes);

                    progress?.Report(new DownloadProgress(fileName, percentage, speed, received, totalBytes >= 0 ? (long?)totalBytes : null));
                }
            }
            finally { ArrayPool<byte>.Shared.Return(buffer); }
        }

        // final report
        progress?.Report(new DownloadProgress(Path.GetFileName(filePath), 100.0, received / Math.Max(1.0, sw.Elapsed.TotalSeconds), received, totalBytes >= 0 ? (long?)totalBytes : null));
    }

    private static string GetSafeFileNameFromUrl(string url, HttpResponseMessage response)
    {
        try
        {
            // try content-disposition first
            if (response.Content.Headers.ContentDisposition?.FileName != null)
            {
                return SanitizeFileName(response.Content.Headers.ContentDisposition.FileName.Trim('"'));
            }

            var uri = new Uri(url);
            var name = Path.GetFileName(uri.LocalPath);
            if (string.IsNullOrWhiteSpace(name)) name = uri.Host;
            return SanitizeFileName(name);
        }
        catch { return null; }
    }

    private static string SanitizeFileName(string name)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        return name;
    }
}
