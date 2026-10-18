using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal interface IFileIssuerPin : IDisposable
{
    uint Pid { get; }
    bool Alive();
    ulong Birth(); // Fresh on every observation, never cached.
}

internal sealed class FileGeneration : IDisposable
{
    private sealed record Entry(IFileIssuerPin Pin, long From);
    private readonly Dictionary<uint, Entry> pins = new();
    private readonly Func<uint, IFileIssuerPin?> open;
    private readonly Func<long> clock;
    private readonly Func<uint, IEnumerable<uint>> peers;
    private readonly HashSet<uint> primed = new();
    private readonly long ttl;
    private readonly int cap;
    internal int Count => pins.Count;
    internal FileGeneration(Func<uint, IFileIssuerPin?>? factory = null, Func<long>? timestamp = null,
        long? lifetime = null, int capacity = 128, Func<uint, IEnumerable<uint>>? siblings = null)
    {
        open = factory ?? NativePin.Open;
        peers = siblings ?? (factory == null ? FileThreadIds.InProcess : _ => []);
        clock = timestamp ?? Stopwatch.GetTimestamp;
        ttl = lifetime ?? Stopwatch.Frequency * 30;
        cap = capacity;
    }
    internal FileObservation Observe(FileObservation value)
    {
        if (value.path == null || value.eventId != 15 || value.version != 1 || value.issuingTid is not { } tid ||
            tid is 0 or uint.MaxValue || !long.TryParse(value.qpc, out long eventTime) || eventTime < 0)
            return value;
        long now = clock();
        foreach (var key in pins.Where(pair => now - pair.Value.From > ttl).Select(pair => pair.Key).ToArray())
        { pins[key].Pin.Dispose(); pins.Remove(key); }
        primed.RemoveWhere(pid => !pins.Values.Any(entry => entry.Pin.Pid == pid));
        if (pins.TryGetValue(tid, out var entry) && !entry.Pin.Alive())
        { entry.Pin.Dispose(); pins.Remove(tid); entry = null; }
        if (entry == null)
        {
            if (pins.Count >= cap) return value;
            IFileIssuerPin? pin;
            try { pin = open(tid); } catch { return value; }
            if (pin == null) return value;
            pins.Add(tid, new(pin, clock()));
            Prime(value, pin);
            return value; // The lookup happened after this event: no retrospective proof.
        }
        Prime(value, entry.Pin);
        if (eventTime <= entry.From || eventTime > now) return value;
        long from = clock();
        ulong birth = entry.Pin.Birth();
        long to = clock();
        if (birth == 0 || !entry.Pin.Alive()) return value;
        return value with
        {
            issuerStatus = "verified", issuerPid = entry.Pin.Pid,
            issuerInterval = new { fromQpc = entry.From.ToString(), toQpc = to.ToString() },
            generationStatus = "verified", generationWitness = birth.ToString(), generationSource = "createTime100ns",
            generationInterval = new { fromQpc = from.ToString(), toQpc = to.ToString() }
        };
    }
    private void Prime(FileObservation value, IFileIssuerPin owner)
    {
        // A scoped read identifies an owner through a held thread, never the ETW
        // header PID. Hold its existing workers before their FUTURE reads. This
        // bounded snapshot is once per retained owner, outside the mapper lock.
        if (value.path == null || !owner.Alive() || !primed.Add(owner.Pid)) return;
        try
        {
            foreach (uint tid in peers(owner.Pid).Take(cap))
            {
                if (pins.Count >= cap || !owner.Alive()) break;
                if (tid is 0 or uint.MaxValue || pins.ContainsKey(tid)) continue;
                IFileIssuerPin? pin = null;
                try
                {
                    pin = open(tid);
                    if (pin == null || pin.Pid != owner.Pid || !pin.Alive() || !owner.Alive()) continue;
                    pins.Add(tid, new(pin, clock()));
                    pin = null; // Ownership transferred to the bounded pin table.
                }
                finally { pin?.Dispose(); }
            }
        }
        catch { /* Denied snapshots/handles leave the remaining workers unresolved. */ }
    }
    public void Dispose()
    {
        foreach (var entry in pins.Values) entry.Pin.Dispose();
        pins.Clear();
        primed.Clear();
    }
    private sealed class NativePin(SafeWaitHandle thread, SafeProcessHandle process, uint pid) : IFileIssuerPin
    {
        [DllImport("kernel32.dll")] private static extern SafeWaitHandle OpenThread(uint rights, bool inherit, uint tid);
        [DllImport("kernel32.dll")] private static extern uint GetProcessIdOfThread(SafeWaitHandle thread);
        [DllImport("kernel32.dll")] private static extern SafeProcessHandle OpenProcess(uint rights, bool inherit, uint pid);
        [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(SafeProcessHandle process,
            out ulong birth, out ulong exit, out ulong kernel, out ulong user);
        [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(SafeHandle handle, uint timeout);
        public uint Pid => pid;
        public bool Alive() => WaitForSingleObject(thread, 0) == 258 && WaitForSingleObject(process, 0) == 258;
        public ulong Birth() => GetProcessTimes(process, out var birth, out var exit, out _, out _) && exit == 0 ? birth : 0;
        public void Dispose() { thread.Dispose(); process.Dispose(); }
        internal static IFileIssuerPin? Open(uint tid)
        {
            var thread = OpenThread(0x100800, false, tid);
            if (thread.IsInvalid) { thread.Dispose(); return null; }
            uint pid = GetProcessIdOfThread(thread);
            var process = OpenProcess(0x101000, false, pid);
            var result = new NativePin(thread, process, pid);
            // A held thread must still be alive after opening its owner process;
            // PID reuse during lookup cannot substitute another process object.
            if (pid == 0 || process.IsInvalid || !result.Alive()) { result.Dispose(); return null; }
            return result;
        }
    }
}
