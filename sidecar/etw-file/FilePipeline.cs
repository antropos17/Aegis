using System.Diagnostics;

namespace Aegis.EtwLifecycle;

// The mapper only resolves lifecycle evidence and queues bounded output. Process
// probes, serialization, pipe writes and native statistics stay on the reader side.
internal sealed class FilePipeline : IDisposable
{
    private sealed record Output(FileObservation Record, int Bytes);
    private readonly object gate = new();
    private readonly Queue<Output> outbound = new();
    private TaskCompletionSource<bool> outputReady = NewReady();
    private readonly FileIngress ingress;
    private readonly FileMapping map;
    private readonly bool live;
    private readonly Func<FileObservation, FileObservation> observe;
    private readonly Func<long> clock;
    private readonly CancellationTokenSource cancel = new();
    private int bytes, highRecords, highBytes;
    private bool completed;
    private ulong filtered, outputOverflowDropped, outputInvalidatedDropped;
    private ulong invalidation;
    private long lastGeneration;
    internal ulong OutputDropped { get { lock (gate) return outputOverflowDropped + outputInvalidatedDropped; } }
    internal Task Worker { get; }
    // Level-triggered under the queue lock: enqueue before or after registration
    // cannot lose a wakeup. One current task, no accumulating signal tokens.
    internal Task OutputAvailable { get { lock (gate) return outputReady.Task; } }
    private static TaskCompletionSource<bool> NewReady() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal FilePipeline(FileIngress input, FileScope scope, bool native,
        Func<FileObservation, FileObservation>? observer = null, Func<long>? timestamp = null)
    {
        ingress = input; map = new(scope, Stopwatch.Frequency); live = native;
        observe = observer ?? FileGeneration.Observe;
        clock = timestamp ?? Stopwatch.GetTimestamp;
        Worker = Task.Factory.StartNew(Run, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }
    internal void Invalidate(long qpc)
    {
        lock (gate)
        {
            map.Reset(qpc);
            invalidation++;
            outputInvalidatedDropped += (ulong)outbound.Count; outbound.Clear(); bytes = 0;
            if (outputReady.Task.IsCompleted) outputReady = NewReady();
        }
    }
    internal void Complete() { lock (gate) completed = true; }
    internal void Cancel() => cancel.Cancel();
    private void Run()
    {
        long lastUnresolved = 0;
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
                // Retained record/string allowance; JSON bytes are created only by the
                // bounded writer. Counting memory must not serialize on the mapper.
                int cost = 2048 + (record.path?.Length ?? 0) * 2;
                lock (gate)
                {
                    if (epoch != map.Epoch) { outputInvalidatedDropped++; continue; }
                    if (outbound.Count >= 4096 || bytes + cost > 4 * 1024 * 1024)
                    { outputOverflowDropped++; continue; }
                    outbound.Enqueue(new(record, cost)); bytes += cost;
                    highRecords = Math.Max(highRecords, outbound.Count); highBytes = Math.Max(highBytes, bytes);
                    if (outbound.Count == 1) outputReady.TrySetResult(true);
                }
            }
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { }
    }
    internal FileObservation? Take()
    {
        FileObservation record;
        ulong epoch;
        lock (gate)
        {
            if (!outbound.TryDequeue(out var item)) return null;
            bytes -= item.Bytes; record = item.Record; epoch = invalidation;
            if (outbound.Count == 0) outputReady = NewReady();
        }
        // One serial reader owns the probe budget. Never hold the map/queue lock
        // across a native call, and never cache a process creation observation.
        long time = clock();
        if (live && time - lastGeneration >= Stopwatch.Frequency / 100)
        {
            lastGeneration = time;
            record = observe(record);
        }
        lock (gate)
        {
            // A gap may have invalidated queued evidence while the probe ran.
            if (epoch != invalidation) { outputInvalidatedDropped++; return null; }
            return record;
        }
    }
    internal object Totals()
    {
        lock (gate)
        {
            var total = ingress.Totals();
            ulong outputDropped = outputOverflowDropped + outputInvalidatedDropped;
            return new
            {
                delivered = total.Delivered.ToString(),
                filtered = filtered.ToString(),
                dropped = (total.Dropped + outputDropped).ToString(),
                ingressDropped = total.Dropped.ToString(),
                outputDropped = outputDropped.ToString(),
                outputOverflowDropped = outputOverflowDropped.ToString(),
                outputInvalidatedDropped = outputInvalidatedDropped.ToString(),
                decoderErrors = total.Errors.ToString(),
                mapEpoch = map.Epoch.ToString(),
                mapResets = map.Resets.ToString(),
                mapConflicts = map.Conflicts.ToString()
            };
        }
    }
    internal object Queues() => QueueSnapshot().combined;
    internal FileQueueSnapshot QueueSnapshot()
    {
        lock (gate)
        {
            var input = ingress.Snapshot();
            // v1 queue fields describe maxima across two independently capped stages.
            return new(
                new(Math.Max(input.Records, outbound.Count), Math.Max(input.Bytes, bytes),
                    Math.Max(input.HighRecords, highRecords), Math.Max(input.HighBytes, highBytes)),
                new(input.Records, input.Bytes, input.HighRecords, input.HighBytes),
                new(outbound.Count, bytes, highRecords, highBytes));
        }
    }
    public void Dispose() { cancel.Cancel(); if (Worker.IsCompleted) cancel.Dispose(); }
}
