using System.Runtime.InteropServices;

namespace Aegis.EtwLifecycle;

internal sealed record TraceStats(uint QueryStatus, uint? EventsLost, uint? RealTimeBuffersLost,
    uint? LogBuffersLost, uint? NumberOfBuffers, uint? BufferSizeKiB, uint? AbsentStatus = null);
internal interface ITraceApi
{
    uint Start(out ulong handle);
    TraceStats Query();
    TraceStats Stop(ulong handle);
}

// Ownership is set only by a successful StartTrace. Collision never grants cleanup
// authority over an existing session. Stop uses the handle we actually created.
internal sealed class OwnedTrace(ITraceApi api) : IDisposable
{
    private ulong handle;
    private bool owns;
    private TraceStats? stopped;
    internal TraceStats Start()
    {
        if (owns || stopped != null) throw new InvalidOperationException();
        uint status = api.Start(out handle);
        if (status != 0) throw new System.ComponentModel.Win32Exception((int)status);
        owns = true;
        return api.Query();
    }
    internal TraceStats Stop()
    {
        if (stopped != null) return stopped;
        if (!owns) throw new InvalidOperationException();
        var result = api.Stop(handle);
        // A failed stop does not discard ownership: Dispose can retry our handle.
        if (result.QueryStatus == 0) { owns = false; stopped = result; }
        return result;
    }
    internal TraceStats? StopIfOwned() => owns || stopped != null ? Stop() : null;
    public void Dispose() { if (owns) Stop(); }
}

internal sealed class NativeTrace : ITraceApi
{
    internal const string Name = "AEGIS-EtwLifecycle";
    [StructLayout(LayoutKind.Sequential)]
    private struct Wnode
    {
        public uint BufferSize, ProviderId; public ulong HistoricalContext;
        public long TimeStamp; public Guid Guid; public uint ClientContext, Flags;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Properties
    {
        public Wnode Wnode;
        public uint BufferSize, MinimumBuffers, MaximumBuffers, MaximumFileSize, LogFileMode;
        public uint FlushTimer, EnableFlags; public int AgeLimit;
        public uint NumberOfBuffers, FreeBuffers, EventsLost, BuffersWritten, LogBuffersLost, RealTimeBuffersLost;
        public IntPtr LoggerThreadId; public uint LogFileNameOffset, LoggerNameOffset;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint StartTrace(out ulong handle, string name, IntPtr properties);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ControlTrace(ulong handle, string? name, IntPtr properties, uint code);

    internal static void CheckLayout()
    {
        if (Marshal.SizeOf<Wnode>() != 48 || Marshal.OffsetOf<Properties>(nameof(Properties.EventsLost)).ToInt32() != 88)
            throw new InvalidOperationException("layout-invalid");
    }
    private static IntPtr Allocate(bool start)
    {
        CheckLayout();
        int size = Marshal.SizeOf<Properties>() + 4096;
        var memory = Marshal.AllocHGlobal(size);
        Marshal.Copy(new byte[size], 0, memory, size);
        var value = new Properties
        {
            Wnode = new Wnode { BufferSize = (uint)size, Flags = 0x20000, ClientContext = 1, Guid = start ? Guid.NewGuid() : Guid.Empty },
            LoggerNameOffset = (uint)Marshal.SizeOf<Properties>(),
            BufferSize = 64,
            MinimumBuffers = 256,
            MaximumBuffers = 256,
            LogFileMode = 0x100,
            FlushTimer = 1 // real time; NO provider enable call
        };
        Marshal.StructureToPtr(value, memory, false);
        return memory;
    }
    public uint Start(out ulong handle)
    {
        var memory = Allocate(true);
        try { return StartTrace(out handle, Name, memory); }
        finally { Marshal.FreeHGlobal(memory); }
    }
    public TraceStats Query() => Control(0, Name, 0);
    public TraceStats Stop(ulong handle)
    {
        var result = Control(handle, null, 1);
        return result with { AbsentStatus = result.QueryStatus == 0 ? Query().QueryStatus : null };
    }
    private static TraceStats Control(ulong handle, string? name, uint code)
    {
        var memory = Allocate(false);
        try
        {
            uint status = ControlTrace(handle, name, memory, code);
            if (status != 0) return new(status, null, null, null, null, null);
            var value = Marshal.PtrToStructure<Properties>(memory);
            return new(0, value.EventsLost, value.RealTimeBuffersLost, value.LogBuffersLost, value.NumberOfBuffers, value.BufferSize);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
}
