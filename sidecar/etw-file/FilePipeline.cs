using System.Diagnostics;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

// A separate bounded mapper keeps pipe writes and native statistics queries out
// of the raw lifecycle ingress drain. All retained output has its own byte cap.
internal sealed class FilePipeline : IDisposable
{
    private sealed record Output(FileObservation Record, int Bytes);
    private readonly object gate = new();
    private readonly Queue<Output> outbound = new();
    private readonly FileIngress ingress;
    private readonly FileMapping map;
    private readonly bool live;
    private readonly CancellationTokenSource cancel = new();
    private int bytes, highRecords, highBytes;
    private bool completed;
    private ulong filtered, outputDropped;
    internal ulong OutputDropped { get { lock (gate) return outputDropped; } }
    internal Task Worker { get; }
    internal FilePipeline(FileIngress input, FileScope scope, bool native)
    {
        ingress = input; map = new(scope, Stopwatch.Frequency); live = native;
        Worker = Task.Factory.StartNew(Run, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }
    internal void Invalidate(long qpc)
    {
        lock (gate)
        {
            map.Reset(qpc);
            outputDropped += (ulong)outbound.Count; outbound.Clear(); bytes = 0;
        }
    }
    internal void Complete() { lock (gate) completed = true; }
    internal void Cancel() => cancel.Cancel();
    private void Run()
    {
        long lastGeneration = 0, lastUnresolved = 0;
        try
        {
            while (true)
            {
                cancel.Token.ThrowIfCancellationRequested();
                var (input, gap, qpc) = ingress.Take();
                if (gap) { Invalidate(qpc); continue; }
                if (input == null)
                {
                    lock (gate) { if (completed) return; }
                    ingress.WaitBlocking(cancel.Token); continue;
                }
                FileObservation? record;
                ulong epoch;
                lock (gate)
                {
                    record = map.Accept(input); epoch = map.Epoch;
                    if (record == null) { filtered++; continue; }
                }
                long time = Stopwatch.GetTimestamp();
                if (record.path == null)
                {
                    if (time - lastUnresolved < Stopwatch.Frequency / 10) { lock (gate) filtered++; continue; }
                    lastUnresolved = time;
                }
                if (live && time - lastGeneration >= Stopwatch.Frequency / 100)
                { record = FileGeneration.Observe(record); lastGeneration = time; }
                int cost = 1024 + JsonSerializer.SerializeToUtf8Bytes(record).Length + (record.path?.Length ?? 0) * 2;
                lock (gate)
                {
                    if (epoch != map.Epoch || outbound.Count >= 4096 || bytes + cost > 4 * 1024 * 1024)
                    { outputDropped++; continue; }
                    outbound.Enqueue(new(record, cost)); bytes += cost;
                    highRecords = Math.Max(highRecords, outbound.Count); highBytes = Math.Max(highBytes, bytes);
                }
            }
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { }
    }
    internal FileObservation? Take()
    {
        lock (gate)
        {
            if (!outbound.TryDequeue(out var item)) return null;
            bytes -= item.Bytes; return item.Record;
        }
    }
    internal object Totals()
    {
        lock (gate)
        {
            var total = ingress.Totals();
            return new
            {
                delivered = total.Delivered.ToString(),
                filtered = filtered.ToString(),
                dropped = (total.Dropped + outputDropped).ToString(),
                decoderErrors = total.Errors.ToString(),
                mapEpoch = map.Epoch.ToString(),
                mapResets = map.Resets.ToString(),
                mapConflicts = map.Conflicts.ToString()
            };
        }
    }
    internal object Queues()
    {
        lock (gate)
        {
            var input = ingress.Snapshot();
            // v1 queue fields describe maxima across two independently capped stages.
            return new
            {
                records = Math.Max(input.Records, outbound.Count),
                bytes = Math.Max(input.Bytes, bytes),
                highWaterRecords = Math.Max(input.HighRecords, highRecords),
                highWaterBytes = Math.Max(input.HighBytes, highBytes)
            };
        }
    }
    public void Dispose() { cancel.Cancel(); if (Worker.IsCompleted) cancel.Dispose(); }
}
