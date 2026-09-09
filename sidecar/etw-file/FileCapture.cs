using System.Globalization;
using Microsoft.Diagnostics.Tracing;

namespace Aegis.EtwLifecycle;

internal sealed class FileCapture(FileIngress ingress) : IDisposable
{
    internal static readonly Guid Provider = new("edd08927-9cc4-4e65-b970-c2560fb5c289");
    private ETWTraceEventSource? source;
    internal Task? Consumer;
    internal void Start()
    {
        source = new ETWTraceEventSource(FileTrace.Name, TraceEventSourceType.Session);
        source.Dynamic.All += Decode;
        source.UnhandledEvents += value => { if (value.ProviderGuid == Provider) ingress.DecodeError(); };
        // Process() blocks for the lifetime of the trace; do not occupy the shared
        // pool worker needed by the mapper and pipe continuations during bursts.
        Consumer = Task.Factory.StartNew(() => source.Process(), CancellationToken.None,
            TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }
    private void Decode(TraceEvent value)
    {
        if (value.ProviderGuid != Provider) return;
        try
        {
            int id = (int)value.ID;
            if (!FileWire.Schemas.Contains($"{id}:{value.Version}")) { ingress.DecodeError(); return; }
            object? Field(string key)
            {
                var actual = value.PayloadNames.FirstOrDefault(n => n.Equals(key, StringComparison.OrdinalIgnoreCase));
                return actual == null ? null : value.PayloadByName(actual);
            }
            ulong Pointer(string key) => Field(key) is { } field ?
                field is IntPtr pointer ? unchecked((ulong)pointer.ToInt64()) : Convert.ToUInt64(field, CultureInfo.InvariantCulture) : 0;
            uint? Tid(string key) => Field(key) is { } field ? checked((uint)(field is IntPtr pointer ?
                pointer.ToInt64() : Convert.ToInt64(field, CultureInfo.InvariantCulture))) : null;
            string? name = Field("FileName") as string ?? Field("OpenPath") as string;
            if (name?.Length > 32768 || (id is 10 or 12 && name == null) ||
                (id == 10 && Field("FileKey") == null) || (id is 12 or 13 or 14 or 15 && Field("FileObject") == null) ||
                (id == 15 && (Field("FileKey") == null || Field("IssuingThreadId") == null)))
            { ingress.DecodeError(); return; }
#pragma warning disable CS0618
            long qpc = value.TimeStampQPC;
#pragma warning restore CS0618
            if (qpc < 0) { ingress.DecodeError(); return; }
            ingress.Enqueue(new(0, id, value.Version, qpc, unchecked((uint)value.ProcessID), unchecked((uint)value.ThreadID),
                Tid("IssuingThreadId"), Tid("ThreadId"), Pointer("FileObject"), Pointer("FileKey"), name));
        }
        catch { ingress.DecodeError(); }
    }
    public void Dispose() { source?.Dispose(); }
}
