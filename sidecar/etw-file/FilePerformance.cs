using System.Diagnostics;

namespace Aegis.EtwLifecycle;

// One serial collector writer owns these counters. Durations are elapsed wall
// ticks, not CPU time; completed calls include failed/cancelled calls.
internal sealed class FileDuration
{
    private ulong calls, total, maximum, failed;
    internal void Record(long ticks, bool failure = false)
    {
        if (ticks < 0) throw new InvalidOperationException();
        calls++; total += (ulong)ticks; maximum = Math.Max(maximum, (ulong)ticks);
        if (failure) failed++;
    }
    internal object Snapshot() => new
    {
        calls = calls.ToString(),
        totalTicks = total.ToString(),
        maxTicks = maximum.ToString(),
        failed = failed.ToString()
    };
}

internal sealed class FilePerformance(Func<long>? timestamp = null, long? frequency = null)
{
    internal readonly FileDuration Pump = new(), OutputWrite = new(), IdleWait = new();
    internal long Now() => (timestamp ?? Stopwatch.GetTimestamp)();
    internal object Snapshot(FileQueueSnapshot queues) => new
    {
        frequency = (frequency ?? Stopwatch.Frequency).ToString(),
        asOfQpc = Now().ToString(),
        pump = Pump.Snapshot(),
        outputWrite = OutputWrite.Snapshot(),
        idleWait = IdleWait.Snapshot(),
        ingress = queues.ingress,
        output = queues.output,
        outputFlow = queues.flow,
        brokerForward = (object?)null // Filled by the normal-token broker, never invented here.
    };
}

internal sealed record FileQueueDepth(int records, int bytes, int highWaterRecords, int highWaterBytes);
internal sealed record FileQueueSnapshot(FileQueueDepth combined, FileQueueDepth ingress, FileQueueDepth output, object? flow = null);
