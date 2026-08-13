using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

/// <summary>
/// One NtQuerySystemInformation call per snapshot, parsed straight into the wire
/// JSON. No per-process handles are opened, so the "GetProcessTimes is inaccessible
/// for a quarter of the process table" problem does not apply here.
///
/// LAYOUT. SYSTEM_PROCESS_INFORMATION is documented on MS Learn with a 48-byte
/// Reserved1 block that hides CreateTime. The offsets below are the x64 layout of
/// that block, and every one of them is checked at startup against an independent
/// oracle (Probe): our own record must be present, its CreateTime must equal
/// GetProcessTimes on our own handle exactly, its image name must be non-empty, and
/// the NextEntryOffset chain must terminate inside the returned length. If any check
/// fails the process exits non-zero instead of emitting numbers it cannot vouch for.
/// </summary>
public static class NtSnapshot {
    [DllImport("ntdll.dll")]
    private static extern int NtQuerySystemInformation(int cls, IntPtr buffer, int length, out int returnLength);

    [DllImport("kernel32.dll")]
    private static extern bool GetProcessTimes(IntPtr handle, out long create, out long exit, out long kernel, out long user);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    private static extern int GetCurrentProcessId();

    /// <summary>SystemProcessInformation. The only class this sidecar queries.</summary>
    private const int SystemProcessInformation = 5;

    private const uint StatusInfoLengthMismatch = 0xC0000004u;
    private const uint StatusInvalidInfoClass = 0xC0000003u;
    private const uint StatusNotImplemented = 0xC0000002u;

    // x64 offsets inside SYSTEM_PROCESS_INFORMATION.
    private const int OffNextEntry = 0x00;   // ULONG NextEntryOffset
    private const int OffCreateTime = 0x20;  // LARGE_INTEGER CreateTime (100 ns FILETIME ticks)
    private const int OffNameLength = 0x38;  // USHORT UNICODE_STRING.Length (bytes)
    private const int OffNameBuffer = 0x40;  // PWSTR  UNICODE_STRING.Buffer
    private const int OffUniquePid = 0x50;   // HANDLE UniqueProcessId
    private const int OffParentPid = 0x58;   // HANDLE InheritedFromUniqueProcessId
    private const int EntrySize = 0x60;      // smallest span this parser reads

    /// <summary>Upper bound on entries walked, so a malformed chain cannot spin.</summary>
    private const int MaxEntries = 100000;

    /// <summary>Largest buffer we will ask the kernel to fill.</summary>
    private const int MaxBufferBytes = 64 * 1024 * 1024;

    private static IntPtr _buffer = IntPtr.Zero;
    private static int _bufferSize = 0;

    /// <summary>Microseconds the last snapshot spent inside the query plus the parse.</summary>
    public static long LastDurationUs;

    /// <summary>
    /// Fill the shared buffer with a fresh process table.
    /// </summary>
    /// <returns>bytes written by the kernel</returns>
    private static int Query() {
        if (_bufferSize == 0) {
            _bufferSize = 2 * 1024 * 1024;
            _buffer = Marshal.AllocHGlobal(_bufferSize);
        }
        for (int attempt = 0; attempt < 8; attempt++) {
            int returned;
            int status = NtQuerySystemInformation(SystemProcessInformation, _buffer, _bufferSize, out returned);
            if (status == 0) return returned;
            uint ustatus = (uint)status;
            if (ustatus == StatusInvalidInfoClass || ustatus == StatusNotImplemented) {
                throw new InvalidOperationException("SystemProcessInformation unavailable (0x" + ustatus.ToString("X8") + ")");
            }
            if (ustatus != StatusInfoLengthMismatch) {
                throw new InvalidOperationException("NtQuerySystemInformation failed (0x" + ustatus.ToString("X8") + ")");
            }
            // Grow-and-retry is the NORMAL path, not a failure: the table changes size
            // between the size query and the fill. Slack keeps a busy machine from
            // looping. Conflating this status with "class absent" is how a capability
            // probe goes wrong, so the two are branched separately above.
            int wanted = returned > _bufferSize ? returned : _bufferSize * 2;
            wanted += 256 * 1024;
            if (wanted > MaxBufferBytes) {
                throw new InvalidOperationException("process table exceeds " + MaxBufferBytes + " bytes");
            }
            Marshal.FreeHGlobal(_buffer);
            _bufferSize = wanted;
            _buffer = Marshal.AllocHGlobal(_bufferSize);
        }
        throw new InvalidOperationException("process table kept growing across 8 attempts");
    }

    /// <summary>Read the image name of one entry, or an empty string.</summary>
    private static string ReadName(IntPtr entry) {
        ushort byteLength = (ushort)Marshal.ReadInt16(entry, OffNameLength);
        IntPtr buffer = Marshal.ReadIntPtr(entry, OffNameBuffer);
        if (buffer == IntPtr.Zero || byteLength == 0) return "";
        return Marshal.PtrToStringUni(buffer, byteLength / 2);
    }

    /// <summary>
    /// Startup self-check. The snapshot must describe THIS process the way an
    /// independent API describes it, or the offsets are wrong and every number that
    /// follows would be fiction.
    /// </summary>
    /// <returns>null when the check passes, otherwise the reason it failed</returns>
    public static string Probe() {
        int size;
        try {
            size = Query();
        } catch (Exception ex) {
            return ex.Message;
        }
        long ownCreate, exitTime, kernelTime, userTime;
        if (!GetProcessTimes(GetCurrentProcess(), out ownCreate, out exitTime, out kernelTime, out userTime)) {
            return "GetProcessTimes failed on our own handle";
        }
        int ownPid = GetCurrentProcessId();
        long offset = 0;
        int seen = 0;
        bool foundSelf = false;
        while (true) {
            if (offset + EntrySize > size) return "entry at " + offset + " runs past the returned " + size + " bytes";
            IntPtr entry = new IntPtr(_buffer.ToInt64() + offset);
            long pid = Marshal.ReadIntPtr(entry, OffUniquePid).ToInt64();
            if (pid == ownPid) {
                foundSelf = true;
                long createTime = Marshal.ReadInt64(entry, OffCreateTime);
                if (createTime != ownCreate) {
                    return "CreateTime disagrees with GetProcessTimes (" + createTime + " vs " + ownCreate + ")";
                }
                if (ReadName(entry).Length == 0) return "our own image name came back empty";
            }
            seen++;
            if (seen > MaxEntries) return "process chain did not terminate";
            int next = Marshal.ReadInt32(entry, OffNextEntry);
            if (next == 0) break;
            if (next < 0) return "negative NextEntryOffset";
            offset += next;
        }
        if (!foundSelf) return "our own pid " + ownPid + " is missing from the snapshot";
        if (seen < 2) return "only " + seen + " process in the snapshot";
        return null;
    }

    /// <summary>The hello frame, carrying the runtime capability probe's result.</summary>
    public static string HelloJson(int protocolVersion) {
        StringBuilder sb = new StringBuilder(160);
        sb.Append("{\"t\":\"hello\",\"proto\":").Append(protocolVersion);
        // class5 / no sequence numbers: see sidecar/procsnap/README.md — the
        // SystemBasicProcessInformation enum value is not published by any primary
        // source we could verify, and this sidecar does not guess kernel info classes.
        sb.Append(",\"caps\":{\"class\":\"class5\",\"sequence\":false,\"topology\":true}");
        sb.Append(",\"pid\":").Append(GetCurrentProcessId());
        sb.Append(",\"impl\":\"csharp-net48\"}");
        return sb.ToString();
    }

    /// <summary>
    /// One snapshot, serialised. 64-bit values (creation time in 100 ns ticks) go out
    /// as decimal STRINGS: they exceed what a JS number holds exactly, and a witness
    /// that lost its low digits would compare equal across two generations.
    /// </summary>
    public static string SnapshotJson(long id) {
        Stopwatch watch = Stopwatch.StartNew();
        int size = Query();
        StringBuilder sb = new StringBuilder(96 * 1024);
        sb.Append("{\"t\":\"snap\",\"id\":").Append(id).Append(",\"source\":\"class5\",\"procs\":[");
        long offset = 0;
        int seen = 0;
        bool first = true;
        while (true) {
            if (offset + EntrySize > size) break;
            IntPtr entry = new IntPtr(_buffer.ToInt64() + offset);
            long pid = Marshal.ReadIntPtr(entry, OffUniquePid).ToInt64();
            if (pid > 0) {
                long ppid = Marshal.ReadIntPtr(entry, OffParentPid).ToInt64();
                long createTime = Marshal.ReadInt64(entry, OffCreateTime);
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"pid\":").Append(pid);
                sb.Append(",\"ppid\":").Append(ppid);
                sb.Append(",\"name\":");
                Json.AppendString(sb, ReadName(entry));
                // A process the kernel reports without a creation time gets no `ct`
                // rather than a zero: absence is honest, zero would be a witness.
                if (createTime > 0) sb.Append(",\"ct\":\"").Append(createTime.ToString()).Append('"');
                sb.Append('}');
            }
            seen++;
            if (seen > MaxEntries) break;
            int next = Marshal.ReadInt32(entry, OffNextEntry);
            if (next <= 0) break;
            offset += next;
        }
        watch.Stop();
        LastDurationUs = watch.ElapsedTicks * 1000000L / Stopwatch.Frequency;
        sb.Append("],\"us\":").Append(LastDurationUs).Append('}');
        return sb.ToString();
    }
}
