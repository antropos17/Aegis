using System.Runtime.InteropServices;

namespace Aegis.EtwProcess;

internal interface IProcessSession : IDisposable
{
    string Name { get; }
    void Start();
    void Enable();
    (uint Status, ProcessLoss Loss) Stop();
}

// Native controller is internal and has no CLI or application launch route.
// A successful StartTrace grants ownership of precisely the returned handle.
internal sealed class ProcessSession(string generation) : IProcessSession
{
    public string Name => $"AEGIS-ProcessDiagnostic-{generation}";
    private readonly Guid identity = Guid.NewGuid();
    private ulong handle;
    private bool owned;
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
    [StructLayout(LayoutKind.Sequential)]
    private struct Filter { public ulong Pointer; public uint Size, Type; }
    [StructLayout(LayoutKind.Sequential)]
    private struct EnableParameters
    {
        public uint Version, EnableProperty, ControlFlags; public Guid Source;
        public IntPtr Filters; public uint Count;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint StartTrace(out ulong handle, string name, IntPtr properties);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ControlTrace(ulong handle, string? name, IntPtr properties, uint code);
    [DllImport("advapi32.dll")]
    private static extern uint EnableTraceEx2(ulong handle, in Guid provider, uint code, byte level,
        ulong any, ulong all, uint timeout, in EnableParameters parameters);

    internal static void VerifyLayout()
    {
        if (IntPtr.Size != 8 || Marshal.SizeOf<Wnode>() != 48 || Marshal.SizeOf<Filter>() != 16 ||
            Marshal.OffsetOf<Properties>(nameof(Properties.EventsLost)).ToInt32() != 88 ||
            Marshal.OffsetOf<EnableParameters>(nameof(EnableParameters.Filters)).ToInt32() != 32)
            throw new InvalidDataException("unsupported-layout");
    }
    private IntPtr Allocate()
    {
        VerifyLayout();
        int size = Marshal.SizeOf<Properties>() + 4096;
        var memory = Marshal.AllocHGlobal(size);
        Marshal.Copy(new byte[size], 0, memory, size);
        Marshal.StructureToPtr(new Properties
        {
            Wnode = new Wnode { BufferSize = (uint)size, Flags = 0x20000, ClientContext = 1, Guid = identity },
            LoggerNameOffset = (uint)Marshal.SizeOf<Properties>(), BufferSize = 64,
            MinimumBuffers = 8, MaximumBuffers = 8, LogFileMode = 0x10000100, FlushTimer = 1
        }, memory, false);
        return memory;
    }
    public void Start()
    {
        if (owned) throw new InvalidOperationException("session-owned");
        var memory = Allocate();
        try
        {
            if (StartTrace(out handle, Name, memory) != 0) throw new InvalidDataException("session-start-failed");
            owned = true;
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    public void Enable()
    {
        if (!owned) throw new InvalidOperationException("session-unowned");
        byte[] ids = [1, 0, 3, 0, 1, 0, 2, 0, 15, 0];
        var data = Marshal.AllocHGlobal(ids.Length);
        var descriptor = Marshal.AllocHGlobal(Marshal.SizeOf<Filter>());
        try
        {
            Marshal.Copy(ids, 0, data, ids.Length);
            Marshal.StructureToPtr(new Filter { Pointer = (ulong)data.ToInt64(), Size = (uint)ids.Length,
                Type = 0x80000200 }, descriptor, false);
            var parameters = new EnableParameters { Version = 2, Filters = descriptor, Count = 1 };
            if (EnableTraceEx2(handle, in ProcessSchema.Provider, 1, 4, ProcessSchema.Keyword, 0, 5000, in parameters) != 0)
                throw new InvalidDataException("provider-enable-failed");
        }
        finally { Marshal.FreeHGlobal(descriptor); Marshal.FreeHGlobal(data); }
    }
    public (uint Status, ProcessLoss Loss) Stop()
    {
        if (!owned) throw new InvalidOperationException("session-unowned");
        var memory = Allocate();
        try
        {
            uint status = ControlTrace(handle, null, memory, 1);
            if (status != 0) return (status, new(null, null));
            owned = false;
            var value = Marshal.PtrToStructure<Properties>(memory);
            return (0, new(value.EventsLost, checked(value.RealTimeBuffersLost + value.LogBuffersLost)));
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    public void Dispose() { if (owned) Stop(); }
}
