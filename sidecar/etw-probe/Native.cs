using System.Runtime.InteropServices;
using System.Text;

namespace Aegis.EtwProbe;

internal static class Native
{
    [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern IntPtr OpenThread(uint access, bool inherit, uint tid);
    [DllImport("kernel32.dll")] private static extern uint GetProcessIdOfThread(IntPtr thread);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint QueryDosDevice(string device, StringBuilder target, int length);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ControlTrace(ulong handle, string name, IntPtr properties, uint code);

    [StructLayout(LayoutKind.Sequential)]
    private struct Wnode
    {
        public uint BufferSize, ProviderId;
        public ulong HistoricalContext;
        public long TimeStamp;
        public Guid Guid;
        public uint ClientContext, Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Properties
    {
        public Wnode Wnode;
        public uint BufferSize, MinimumBuffers, MaximumBuffers, MaximumFileSize, LogFileMode;
        public uint FlushTimer, EnableFlags;
        public int AgeLimit;
        public uint NumberOfBuffers, FreeBuffers, EventsLost, BuffersWritten, LogBuffersLost, RealTimeBuffersLost;
        public IntPtr LoggerThreadId;
        public uint LogFileNameOffset, LoggerNameOffset;
    }

    internal static string? DevicePath(string dosPath)
    {
        if (dosPath.Length < 3 || dosPath[1] != ':') return null;
        var target = new StringBuilder(32768);
        if (QueryDosDevice(dosPath[..2], target, target.Capacity) == 0) return null;
        return target + dosPath[2..];
    }

    internal static uint? ThreadOwner(uint? tid)
    {
        if (tid == null || tid == 0) return null;
        var handle = OpenThread(0x0800, false, tid.Value);
        if (handle == IntPtr.Zero) return null;
        try { uint pid = GetProcessIdOfThread(handle); return pid == 0 ? null : pid; }
        finally { CloseHandle(handle); }
    }

    internal sealed record Loss(uint QueryStatus, uint? EventsLost, uint? RealTimeBuffersLost,
        uint? LogBuffersLost, uint? NumberOfBuffers, uint? BufferSizeKb);

    internal static Loss QueryLoss(string name)
    {
        int size = Marshal.SizeOf<Properties>() + 4096;
        var memory = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.Copy(new byte[size], 0, memory, size);
            var value = new Properties
            {
                Wnode = new Wnode { BufferSize = (uint)size },
                LoggerNameOffset = (uint)Marshal.SizeOf<Properties>()
            };
            Marshal.StructureToPtr(value, memory, false);
            uint status = ControlTrace(0, name, memory, 0); // EVENT_TRACE_CONTROL_QUERY
            if (status != 0) return new(status, null, null, null, null, null);
            value = Marshal.PtrToStructure<Properties>(memory);
            return new(0, value.EventsLost, value.RealTimeBuffersLost, value.LogBuffersLost,
                value.NumberOfBuffers, value.BufferSize);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    internal static void CheckLayout()
    {
        if (Marshal.SizeOf<Wnode>() != 48 || Marshal.OffsetOf<Properties>(nameof(Properties.EventsLost)).ToInt32() != 88)
            throw new InvalidOperationException("EVENT_TRACE_PROPERTIES layout mismatch");
    }
}
