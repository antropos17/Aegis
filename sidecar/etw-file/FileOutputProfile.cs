namespace Aegis.EtwLifecycle;

// Owned by the existing output queue lock. Constant work per transition, no
// record/path retention, and at most 256 active 100ms windows (quiet gaps omitted).
internal sealed class FileOutputProfile
{
    internal const int Capacity = 256;
    private readonly long width;
    private readonly Queue<Window> windows = new();
    private readonly FileDuration readyToTake = new();
    private long? readyAt;
    private ulong evicted;
    private int records, bytes;
    private sealed class Window(long from, int count, int size)
    {
        internal readonly long From = from;
        internal readonly int StartRecords = count;
        internal int Records = count, HighRecords = count, HighBytes = size;
        internal ulong Enqueued, Dequeued, Overflow, Invalidated;
        internal object Snapshot(long to) => new
        {
            fromQpc = From.ToString(),
            toQpc = to.ToString(),
            startRecords = StartRecords,
            records = Records,
            highWaterRecords = HighRecords,
            highWaterBytes = HighBytes,
            enqueued = Enqueued.ToString(),
            dequeued = Dequeued.ToString(),
            overflow = Overflow.ToString(),
            invalidated = Invalidated.ToString()
        };
    }
    private Window? current;
    internal FileOutputProfile(long frequency)
    {
        if (frequency < 10) throw new ArgumentOutOfRangeException(nameof(frequency));
        width = frequency / 10;
    }
    private Window At(long now)
    {
        long from = now - now % width;
        if (current == null || from > current.From)
        {
            if (windows.Count == Capacity) { windows.Dequeue(); evicted++; }
            current = new Window(from, records, bytes); windows.Enqueue(current);
        }
        return current;
    }
    internal void Enqueue(long now, int size)
    {
        var window = At(now);
        if (records == 0) readyAt = now;
        window.Enqueued++; records++; bytes += size;
        window.Records = records;
        window.HighRecords = Math.Max(window.HighRecords, records);
        window.HighBytes = Math.Max(window.HighBytes, bytes);
    }
    internal void Dequeue(long now, int size)
    {
        var window = At(now);
        if (readyAt is { } since) { readyToTake.Record(now - since); readyAt = null; }
        window.Dequeued++; records--; bytes -= size; window.Records = records;
    }
    internal void Overflow(long now) => At(now).Overflow++;
    internal void Invalidate(long now)
    {
        var window = At(now);
        window.Invalidated += (ulong)records;
        records = bytes = window.Records = 0; readyAt = null;
    }
    internal object Snapshot(long now)
    {
        At(now);
        return new
        {
            asOfQpc = now.ToString(),
            windowTicks = width.ToString(),
            evictedWindows = evicted.ToString(),
            readyToTake = readyToTake.Snapshot(),
            windows = windows.Select(w => w.Snapshot(Math.Min(now, w.From + width))).ToArray()
        };
    }
}
