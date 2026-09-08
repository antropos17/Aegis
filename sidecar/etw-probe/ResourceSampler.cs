using System.Diagnostics;

namespace Aegis.EtwProbe;

internal sealed record ResourceSample(long Qpc, double ElapsedMs, long? WorkingSetBytes,
    long? PrivateBytes, long? ManagedLiveBytes, long? GcCommittedBytes, int? Gen2Collections,
    Native.Loss? Loss, string? ErrorType)
{
    internal bool Degraded => ErrorType != null || Loss == null || Loss.QueryStatus != 0 ||
        Loss.EventsLost != 0 || Loss.RealTimeBuffersLost != 0 || Loss.LogBuffersLost != 0;
}

// One writer; the caller reads Samples only after Stop. No files are written while
// tracing, no forced GC, and no event dictionaries are read from the timer thread.
internal sealed class ResourceSampler : IAsyncDisposable
{
    private readonly CancellationTokenSource cancel = new();
    private readonly Task loop;
    internal readonly List<ResourceSample> Samples = [];
    internal int Omitted { get; private set; }
    internal bool Degraded => Omitted != 0 || Samples.Any(sample => sample.Degraded);

    internal ResourceSampler(string sessionName, TimeSpan? interval = null, int limit = 200)
    {
        loop = Task.Run(async () =>
        {
            using var process = Process.GetCurrentProcess();
            using var timer = new PeriodicTimer(interval ?? TimeSpan.FromSeconds(5));
            var watch = Stopwatch.StartNew();
            void Sample()
            {
                if (Samples.Count >= limit) { Omitted++; return; }
                long qpc = Stopwatch.GetTimestamp();
                try
                {
                    process.Refresh();
                    Samples.Add(new(qpc, watch.Elapsed.TotalMilliseconds, process.WorkingSet64,
                        process.PrivateMemorySize64, GC.GetTotalMemory(false), GC.GetGCMemoryInfo().TotalCommittedBytes,
                        GC.CollectionCount(2), Native.QueryLoss(sessionName), null));
                }
                catch (Exception error)
                {
                    Samples.Add(new(qpc, watch.Elapsed.TotalMilliseconds, null, null, null, null, null, null,
                        error.GetType().Name));
                }
            }
            Sample();
            try { while (await timer.WaitForNextTickAsync(cancel.Token)) Sample(); }
            catch (OperationCanceledException) when (cancel.IsCancellationRequested) { }
            Sample(); // Final observation is still before the session stops.
        });
    }

    internal async Task Stop()
    {
        cancel.Cancel();
        await loop;
    }

    public async ValueTask DisposeAsync()
    {
        await Stop();
        cancel.Dispose();
    }
}
