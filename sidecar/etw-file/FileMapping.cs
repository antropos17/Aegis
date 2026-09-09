using System.Text;

namespace Aegis.EtwLifecycle;

internal sealed record FileInput(ulong Seq, int Id, int Version, long Qpc, uint Pid, uint Tid,
    uint? Issuing, uint? Payload, ulong Object, ulong Key, string? Name)
{
    internal int Bytes => 256 + (Name?.Length ?? 0) * 2 + (Name == null ? 0 : Encoding.UTF8.GetByteCount(Name));
}
internal sealed record FileObservation(string eventSeq, string provider, int eventId, int version, string qpc,
    uint headerPid, uint headerTid, uint? issuingTid, uint? payloadTid, string? path, string pathEvidence,
    string issuerStatus = "candidate", string generationStatus = "unresolved", string? generationWitness = null,
    string? generationSource = null, object? generationInterval = null, object? agent = null, object? instanceId = null);

internal sealed class FileMapping(FileScope scope, long frequency, int cap = 32768, int byteCap = 8 * 1024 * 1024)
{
    private sealed record Name(string Path, long Qpc, int Bytes);
    private readonly Dictionary<(bool Key, ulong Pointer), Name> names = new();
    private long latest, barrier;
    private int bytes;
    internal ulong Epoch, Resets, Conflicts;
    internal int Count => names.Count;
    internal int Bytes => bytes;
    internal void Reset(long qpc)
    {
        names.Clear(); bytes = 0; Epoch++; Resets++; barrier = Math.Max(barrier, Math.Max(latest, qpc));
    }
    private void Remove((bool, ulong) key)
    {
        if (names.Remove(key, out var value)) bytes -= value.Bytes;
    }
    private Name? Lookup(bool key, ulong pointer, long qpc)
    {
        if (!names.TryGetValue((key, pointer), out var value)) return null;
        if (qpc <= value.Qpc || qpc - value.Qpc > 30 * frequency) { Remove((key, pointer)); return null; }
        return value;
    }
    internal FileObservation? Accept(FileInput input)
    {
        bool old = input.Qpc < latest || input.Qpc <= barrier;
        latest = Math.Max(latest, input.Qpc);
        if (old) { Reset(latest); return input.Id == 15 ? Make(input, null, "unresolved") : null; }
        if (input.Name != null)
        {
            string? selected = scope.Select(input.Name);
            foreach (var pointer in new[] { (false, input.Object), (true, input.Key) })
            {
                if (pointer.Item2 == 0) continue;
                // Rebinds and names outside the selected root also retire prior evidence.
                if (names.TryGetValue(pointer, out var prior) && prior.Path != selected)
                { Conflicts++; Reset(input.Qpc); return null; }
                Remove(pointer);
                if (selected == null) continue;
                int cost = 128 + selected.Length * 2 + Encoding.UTF8.GetByteCount(selected);
                if (names.Count >= cap || bytes + cost > byteCap) { Reset(input.Qpc); return null; }
                names[pointer] = new(selected, input.Qpc, cost); bytes += cost;
            }
        }
        if (input.Id is 10 or 12) return null;
        var byObject = Lookup(false, input.Object, input.Qpc);
        var byKey = Lookup(true, input.Key, input.Qpc);
        bool conflict = byObject != null && byKey != null && byObject.Path != byKey.Path;
        bool retire = input.Id is 13 or 14 && (input.Object == 0 || input.Key == 0 ||
            names.ContainsKey((false, input.Object)) || names.ContainsKey((true, input.Key)));
        if (retire || conflict)
        {
            // Relationship between object/key lifetimes is unproven; retire whole epoch.
            if (conflict) Conflicts++;
            Reset(input.Qpc);
        }
        if (input.Id != 15) return null;
        return Make(input, conflict ? null : byObject?.Path ?? byKey?.Path,
            conflict ? "conflict" : byObject != null ? "candidate-object" : byKey != null ? "candidate-key" : "unresolved");
    }
    private static FileObservation Make(FileInput value, string? path, string evidence) =>
        new(value.Seq.ToString(), FileCapture.Provider.ToString(), value.Id, value.Version, value.Qpc.ToString(),
            value.Pid, value.Tid, value.Issuing, value.Payload, path, evidence,
            value.Pid is 0 or uint.MaxValue ? "unresolved" : "candidate");
}

internal sealed class FileIngress(int cap = 4096, int byteCap = 4 * 1024 * 1024)
{
    private readonly object gate = new();
    private readonly Queue<FileInput> queue = new();
    private readonly SemaphoreSlim available = new(0, 1);
    private int bytes, highRecords, highBytes;
    private bool gap;
    private long latestQpc;
    internal ulong Delivered, Dropped, DecoderErrors;
    internal void Enqueue(FileInput value)
    {
        lock (gate)
        {
            Delivered++;
            latestQpc = Math.Max(latestQpc, value.Qpc);
            value = value with { Seq = Delivered };
            if (available.CurrentCount == 0) available.Release();
            if (queue.Count >= cap || bytes + value.Bytes > byteCap) { Dropped++; gap = true; return; }
            queue.Enqueue(value); bytes += value.Bytes;
            highRecords = Math.Max(highRecords, queue.Count); highBytes = Math.Max(highBytes, bytes);
        }
    }
    internal void DecodeError()
    {
        lock (gate)
        {
            Delivered++; DecoderErrors++; gap = true;
            if (available.CurrentCount == 0) available.Release();
        }
    }
    internal void WaitBlocking(CancellationToken token) => available.Wait(100, token);
    internal (FileInput? Input, bool Gap, long Qpc) Take()
    {
        lock (gate)
        {
            if (gap)
            {
                Dropped += (ulong)queue.Count; queue.Clear(); bytes = 0; gap = false;
                return (null, true, latestQpc);
            }
            if (!queue.TryDequeue(out var value)) return (null, false, latestQpc);
            bytes -= value.Bytes; return (value, false, value.Qpc);
        }
    }
    internal object Queues()
    {
        lock (gate) return new { records = queue.Count, bytes, highWaterRecords = highRecords, highWaterBytes = highBytes };
    }
    internal (ulong Delivered, ulong Dropped, ulong Errors) Totals()
    {
        lock (gate) return (Delivered, Dropped, DecoderErrors);
    }
    internal (int Records, int Bytes, int HighRecords, int HighBytes) Snapshot()
    {
        lock (gate) return (queue.Count, bytes, highRecords, highBytes);
    }
}
