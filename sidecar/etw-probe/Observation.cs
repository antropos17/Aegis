using System.Globalization;
using Microsoft.Diagnostics.Tracing;

namespace Aegis.EtwProbe;

internal sealed record Input(int Id, int Version, double TimeMs, int HeaderPid, int HeaderTid,
    uint? IssuingTid, uint? PayloadTid, string? Object, string? Key, string? Name, long Qpc = 0);

internal sealed record Sample(int Id, int Version, double TimeMs, int HeaderPid, int HeaderTid,
    uint? IssuingTid, uint? PayloadTid, uint? ThreadOwnerAtCallback, string? Object, string? Key,
    string? FixtureFile, string PathEvidence, long Qpc);

// Candidate correlation for measurement only. It is deliberately not shipped into
// AEGIS attribution. Mapping disagreements, unknown reads and overflows remain visible.
internal sealed class Observation(string root, string? deviceRoot, HashSet<int> actorPids, string eviction,
    int sampleLimit = 20000, int mapLimit = 10000)
{
    private readonly Dictionary<string, string> objects = new(), keys = new(), aliases = new();
    internal readonly List<Sample> Samples = [];
    internal readonly Dictionary<int, long> Delivered = new();
    internal readonly Dictionary<string, string[]> Schemas = new();
    internal long Unhandled, DecodeErrors, OmittedSamples, MappingResets, AliasOverflows;
    internal long DecodedReads, FixturePathReads, UnresolvedActorReads, PathConflicts;

    internal string? FixtureName(string? path)
    {
        if (path == null) return null;
        var normalized = path.Replace('/', '\\');
        foreach (var prefix in new[] { root, deviceRoot, "\\??\\" + root, "\\\\?\\" + root })
        {
            if (prefix == null) continue;
            string boundary = prefix.Replace('/', '\\').TrimEnd('\\') + "\\";
            if (!normalized.StartsWith(boundary, StringComparison.OrdinalIgnoreCase)) continue;
            string relative = normalized[boundary.Length..];
            if (relative.Equals("target.dat", StringComparison.OrdinalIgnoreCase)) return "target.dat";
            if (relative.Equals("control.dat", StringComparison.OrdinalIgnoreCase)) return "control.dat";
        }
        return null;
    }

    private string? Alias(string prefix, string? pointer)
    {
        if (pointer == null) return null;
        string key = prefix + pointer;
        if (aliases.TryGetValue(key, out var value)) return value;
        if (aliases.Count >= mapLimit * 2) { AliasOverflows++; return null; }
        value = prefix + aliases.Count.ToString(CultureInfo.InvariantCulture);
        aliases[key] = value;
        return value;
    }

    internal void Accept(Input value, bool queryThread = false)
    {
        if (value.Id == 15) DecodedReads++;
        var direct = FixtureName(value.Name);
        // An observed name rebinds the pointer, even when the new path is outside
        // the fixture. Keeping the old fixture name here would fabricate attribution.
        if (value.Name != null)
        {
            if (value.Object != null) { objects.Remove(value.Object); if (direct != null) objects[value.Object] = direct; }
            if (value.Key != null) { keys.Remove(value.Key); if (direct != null) keys[value.Key] = direct; }
        }
        var byObject = value.Object == null ? null : objects.GetValueOrDefault(value.Object);
        var byKey = value.Key == null ? null : keys.GetValueOrDefault(value.Key);
        bool conflict = byObject != null && byKey != null && byObject != byKey;
        string? file = conflict ? null : direct ?? byObject ?? byKey;
        string evidence = conflict ? "conflict" : direct != null ? "observed-name" : byObject != null
            ? "candidate-object" : byKey != null ? "candidate-key" : "unresolved";
        if (conflict) PathConflicts++;
        if (value.Id == 15)
        {
            if (file != null) FixturePathReads++;
            else if (actorPids.Contains(value.HeaderPid)) UnresolvedActorReads++;
        }
        if (file != null || conflict || actorPids.Contains(value.HeaderPid))
        {
            if (Samples.Count >= sampleLimit) OmittedSamples++;
            else Samples.Add(new(value.Id, value.Version, value.TimeMs, value.HeaderPid, value.HeaderTid,
                value.IssuingTid, value.PayloadTid, queryThread ? Native.ThreadOwner(value.IssuingTid ?? value.PayloadTid) : null,
                Alias("o", value.Object), Alias("k", value.Key), file, evidence, value.Qpc));
        }
        if ((eviction == "close" && value.Id == 14) || (eviction == "cleanup" && value.Id is 13 or 14))
        {
            if (value.Object != null) objects.Remove(value.Object);
            if (value.Key != null) keys.Remove(value.Key);
        }
        if (objects.Count + keys.Count > mapLimit)
        {
            objects.Clear(); keys.Clear(); MappingResets++;
        }
    }

    internal void Decode(TraceEvent data)
    {
        if (data.ProviderGuid != Program.Provider) return;
        try
        {
            if (Schemas.Count < 256) Schemas[$"{(int)data.ID}:{data.Version}"] = data.PayloadNames.Take(64).ToArray();
            object? Field(string name)
            {
                var actual = data.PayloadNames.FirstOrDefault(n => n.Equals(name, StringComparison.OrdinalIgnoreCase));
                return actual == null ? null : data.PayloadByName(actual);
            }
            string? Pointer(string name)
            {
                object? field = Field(name);
                if (field == null) return null;
                ulong number = field is IntPtr ptr ? unchecked((ulong)ptr.ToInt64()) : Convert.ToUInt64(field, CultureInfo.InvariantCulture);
                return number == 0 ? null : number.ToString(CultureInfo.InvariantCulture);
            }
            uint? Tid(string name) => Field(name) is { } item
                ? checked((uint)(item is IntPtr ptr ? ptr.ToInt64() : Convert.ToInt64(item, CultureInfo.InvariantCulture))) : null;
            // Raw QPC is intentional: fixture processes use Stopwatch.GetTimestamp on this host.
#pragma warning disable CS0618
            Accept(new((int)data.ID, data.Version, data.TimeStampRelativeMSec, data.ProcessID, data.ThreadID,
                Tid("IssuingThreadId"), Tid("ThreadId"), Pointer("FileObject"), Pointer("FileKey"),
                Field("FileName") as string ?? Field("OpenPath") as string, data.TimeStampQPC), true);
#pragma warning restore CS0618
        }
        catch { DecodeErrors++; } // No raw payload/error text (which may contain unrelated paths).
    }
}
