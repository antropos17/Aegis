using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal sealed record FileObjectLabel(ulong Volume, string Id, string Path);
internal interface IFileObjectPin : IDisposable
{
    bool Alive();
    ulong Birth();
    FileObjectLabel? Inspect();
}

// This is object identity evidence, not an event-time namespace witness. The
// label was observed before the read; rename/hardlink aliases are not observed.
internal sealed record FileObjectCandidate(string bindingId, uint issuerPid, string createTime100ns,
    string label, string volumeSerial, string fileId128, string fromQpc);
internal sealed record FileObjectBinding(string requestId, string bindingId, string scopeGeneration, string policyGeneration)
{
    internal static FileObjectBinding Parse(System.Text.Json.JsonElement value)
    {
        FileWire.Shape(value, "requestId", "bindingId", "scopeGeneration", "policyGeneration");
        string Get(string key) { string text = value.GetProperty(key).GetString() ?? "";
            if (!FileWire.Id(text)) throw new InvalidDataException(); return text; }
        return new(Get("requestId"), Get("bindingId"), Get("scopeGeneration"), Get("policyGeneration"));
    }
}
internal sealed record FileObjectBound(string requestId, string bindingId, string scopeGeneration,
    string policyGeneration, bool accepted, string? fromQpc);
internal sealed record FileObjectProof(string source, string labelSemantics,
    string bindingId, string scopeGeneration, string policyGeneration, string volumeSerial, string fileId128, string path,
    string fromQpc, string toQpc, object clock);

internal sealed class FileObjectLease : IDisposable
{
    private sealed record Entry(IFileObjectPin Pin, FileObjectLabel Label, long From, string Id,
        FileObjectBinding? Binding = null, long BoundFrom = 0);
    private readonly Dictionary<(uint Pid, ulong Birth, ulong Object), Entry> leases = new();
    private readonly Func<uint, ulong, ulong, IFileObjectPin?> open;
    private readonly Func<long> clock;
    private readonly Func<long> wall;
    private readonly FileScope scope;
    private readonly long frequency, lifetime;
    private readonly int capacity;
    private long serial;
    private long? lastOpen;
    private bool disposed;
    internal int Count => leases.Count;
    internal FileObjectCandidate? Candidate(FileObservation value)
    {
        if (disposed || value.issuerPid is not { } pid || !ulong.TryParse(value.generationWitness, out ulong birth) ||
            !leases.TryGetValue((pid, birth, value.NativeObject), out var entry) || entry.Binding != null) return null;
        return new(entry.Id, pid, birth.ToString(), entry.Label.Path, entry.Label.Volume.ToString(), entry.Label.Id, entry.From.ToString());
    }
    internal FileObjectBound Bind(FileObjectBinding request)
    {
        var denied = new FileObjectBound(request.requestId, request.bindingId, request.scopeGeneration, request.policyGeneration, false, null);
        if (disposed) return denied;
        Expire(clock());
        var selected = leases.FirstOrDefault(pair => pair.Value.Id == request.bindingId);
        var entry = selected.Value;
        if (entry == null || entry.Binding != null) return denied;
        try
        {
            var fresh = entry.Pin.Inspect();
            if (!entry.Pin.Alive() || entry.Pin.Birth() != selected.Key.Birth || fresh == null ||
                fresh.Volume != entry.Label.Volume || fresh.Id != entry.Label.Id ||
                scope.Select(fresh.Path) is not { } label || !StringComparer.OrdinalIgnoreCase.Equals(label, entry.Label.Path))
            { Remove(selected.Key); return denied; }
            long from = clock();
            if (from - entry.From > lifetime) { Remove(selected.Key); return denied; }
            leases[selected.Key] = entry with { Binding = request, BoundFrom = from };
            return denied with { accepted = true, fromQpc = from.ToString() };
        }
        catch { Remove(selected.Key); return denied; }
    }
    internal FileObjectLease(FileScope scope, Func<uint, ulong, ulong, IFileObjectPin?>? factory = null,
        Func<long>? timestamp = null, Func<long>? unix = null, long? ticksPerSecond = null,
        long? ttl = null, int cap = 64)
    {
        // No OS build has qualified the experimental ABI bridge yet. Only the
        // cloud qualification caller may explicitly supply that native factory.
        this.scope = scope; open = factory ?? ((_, _, _) => null);
        clock = timestamp ?? Stopwatch.GetTimestamp;
        wall = unix ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        frequency = ticksPerSecond ?? Stopwatch.Frequency;
        lifetime = ttl ?? frequency * 10; capacity = cap;
    }
    // Only the serial pipeline reader calls this method or disposes retained
    // handles. A mapping/loss epoch invalidation must reset it before use.
    internal FileObjectProof? Observe(FileObservation value, ulong objectPointer)
    {
        if (disposed) return null;
        long now = clock();
        Expire(now);
        if (objectPointer == 0 || value.issuerStatus != "verified" || value.eventId != 15 || value.version != 1 ||
            value.issuerPid is not { } pid || pid is 0 or uint.MaxValue ||
            value.generationStatus != "verified" || value.generationSource != "createTime100ns" ||
            !ulong.TryParse(value.generationWitness, out ulong birth) || birth == 0 ||
            !long.TryParse(value.qpc, out long qpc) || qpc < 0 || qpc > now) return null;
        var key = (pid, birth, objectPointer);
        if (!leases.TryGetValue(key, out var entry))
        {
            if (leases.Count >= capacity || (lastOpen is { } prior && now - prior < frequency)) return null;
            lastOpen = now; // At most one expensive global inventory attempt per second.
            IFileObjectPin? pin = null;
            try
            {
                pin = open(pid, birth, objectPointer);
                if (pin == null || !pin.Alive() || pin.Birth() != birth) return null;
                var label = pin.Inspect();
                if (label == null || scope.Select(label.Path) is not { } selected || label.Id.Length != 32 ||
                    label.Id.Any(c => !char.IsAsciiHexDigit(c)) || !pin.Alive() || pin.Birth() != birth) return null;
                entry = new(pin, label with { Path = selected }, clock(), (++serial).ToString());
                leases.Add(key, entry); pin = null;
            }
            catch { /* Denied/unsupported native observation never creates a lease. */ }
            finally { pin?.Dispose(); }
            return null; // The discovering read predates the retained object proof.
        }
        try
        {
            if (entry.Binding == null || qpc <= entry.BoundFrom) return null;
            if (!entry.Pin.Alive() || entry.Pin.Birth() != birth) { Remove(key); return null; }
            var fresh = entry.Pin.Inspect();
            if (fresh == null || fresh.Volume != entry.Label.Volume || fresh.Id != entry.Label.Id ||
                scope.Select(fresh.Path) is not { } selected ||
                !StringComparer.OrdinalIgnoreCase.Equals(selected, entry.Label.Path) ||
                !entry.Pin.Alive() || entry.Pin.Birth() != birth)
            { Remove(key); return null; }
            long before = clock(), unix = wall(), after = clock();
            if (before < qpc || after < before || after - entry.From > lifetime || unix < 0) return null;
            return new("issuer-handle-file-id", "pre-read-object-binding", entry.Id,
                entry.Binding.scopeGeneration, entry.Binding.policyGeneration,
                entry.Label.Volume.ToString(), entry.Label.Id, entry.Label.Path,
                entry.BoundFrom.ToString(), before.ToString(), new
                {
                    qpc = before.ToString(), unixMs = unix.ToString(),
                    uncertaintyQpc = (after - before + (frequency + 999) / 1000).ToString()
                });
        }
        catch { Remove(key); return null; }
    }
    private void Remove((uint Pid, ulong Birth, ulong Object) key)
    {
        if (leases.Remove(key, out var entry)) entry.Pin.Dispose();
    }
    // A live owner must call this at least once per two seconds even when no reads
    // arrive. It owns the serial timer; this helper creates no background task.
    internal void Sweep() { if (!disposed) Expire(clock()); }
    internal void Reset()
    {
        foreach (var entry in leases.Values) entry.Pin.Dispose();
        leases.Clear(); // Keep serial monotonic so delayed binds cannot alias a new object.
    }
    private void Expire(long now)
    {
        foreach (var key in leases.Where(pair => now - pair.Value.From > lifetime)
            .Select(pair => pair.Key).ToArray()) Remove(key);
    }
    public void Dispose()
    {
        disposed = true;
        Reset();
    }
}
