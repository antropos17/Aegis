using System.Runtime.InteropServices;

namespace Aegis.EtwLifecycle;

internal sealed record FileStats(uint Status, uint? Events, uint? RealTime, uint? Log, uint? Buffers, uint? Size);

// Fixed diagnostic session. Only StartTrace success grants handle-based stop authority.
internal sealed class FileTrace : IDisposable
{
    internal const string Name = "AEGIS-EtwFileDiagnostic";
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
    internal static void Layout()
    {
        if (IntPtr.Size != 8 || Marshal.SizeOf<Wnode>() != 48 || Marshal.SizeOf<Filter>() != 16 ||
            Marshal.OffsetOf<Properties>(nameof(Properties.EventsLost)).ToInt32() != 88 ||
            Marshal.OffsetOf<EnableParameters>(nameof(EnableParameters.Filters)).ToInt32() != 32)
            throw new InvalidOperationException();
    }
    private static IntPtr Allocate()
    {
        Layout();
        int size = Marshal.SizeOf<Properties>() + 4096;
        var memory = Marshal.AllocHGlobal(size); Marshal.Copy(new byte[size], 0, memory, size);
        Marshal.StructureToPtr(new Properties
        {
            Wnode = new Wnode { BufferSize = (uint)size, Flags = 0x20000, ClientContext = 1, Guid = Guid.NewGuid() },
            LoggerNameOffset = (uint)Marshal.SizeOf<Properties>(),
            BufferSize = 64,
            MinimumBuffers = 256,
            MaximumBuffers = 256,
            LogFileMode = 0x100,
            FlushTimer = 1
        }, memory, false);
        return memory;
    }
    internal FileStats Start()
    {
        if (owned) throw new InvalidOperationException();
        var memory = Allocate();
        try
        {
            uint status = StartTrace(out handle, Name, memory);
            if (status != 0) throw new System.ComponentModel.Win32Exception((int)status);
            owned = true;
            return Query();
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    internal void Enable()
    {
        if (!owned) throw new InvalidOperationException();
        // EVENT_FILTER_EVENT_ID: BOOLEAN, reserved byte, USHORT count, USHORT IDs.
        byte[] ids = [1, 0, 5, 0, 10, 0, 12, 0, 13, 0, 14, 0, 15, 0];
        var data = Marshal.AllocHGlobal(ids.Length);
        var descriptor = Marshal.AllocHGlobal(Marshal.SizeOf<Filter>());
        try
        {
            Marshal.Copy(ids, 0, data, ids.Length);
            Marshal.StructureToPtr(new Filter { Pointer = (ulong)data.ToInt64(), Size = (uint)ids.Length, Type = 0x80000200 }, descriptor, false);
            var parameters = new EnableParameters { Version = 2, Filters = descriptor, Count = 1 };
            uint status = EnableTraceEx2(handle, in FileCapture.Provider, 1, 5, 0x1b0, 0, 5000, in parameters);
            if (status != 0) throw new System.ComponentModel.Win32Exception((int)status);
        }
        finally { Marshal.FreeHGlobal(descriptor); Marshal.FreeHGlobal(data); }
    }
    internal FileStats Query() => Control(0);
    internal FileStats Stop()
    {
        if (!owned) throw new InvalidOperationException();
        var result = Control(1);
        if (result.Status == 0) owned = false;
        return result;
    }
    private FileStats Control(uint code)
    {
        if (!owned) throw new InvalidOperationException();
        var memory = Allocate();
        try
        {
            uint status = ControlTrace(handle, null, memory, code);
            if (status != 0) return new(status, null, null, null, null, null);
            var value = Marshal.PtrToStructure<Properties>(memory);
            return new(0, value.EventsLost, value.RealTimeBuffersLost, value.LogBuffersLost, value.NumberOfBuffers, value.BufferSize);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    public void Dispose() { if (owned) Stop(); }
}
