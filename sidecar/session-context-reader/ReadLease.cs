using Aegis.HookConfigTarget;
using Microsoft.Win32.SafeHandles;
using System.Globalization;

namespace Aegis.SessionContextReader;

// Closed host grammar exposes only this lease. Linked TargetLease write/backup
// methods are never instantiated or dispatched by the reader executable.
internal sealed class ReadLease : IDisposable
{
    internal const int MaxBytes = 512 * 1024;
    internal const long MaxTailFileBytes = 9007199254740991;
    private readonly TargetPath path;
    private readonly SafeFileHandle handle;
    private readonly Stamp initial;
    private readonly long maxFileBytes;
    private int calls, returned;
    private long position;
    private bool eof, closed;

    private ReadLease(TargetPath path, SafeFileHandle handle, Stamp initial, bool tail)
    {
        this.path = path; this.handle = handle; this.initial = initial;
        maxFileBytes = tail ? MaxTailFileBytes : MaxBytes;
        // The host selects one fixed suffix, never an arbitrary initial seek.
        position = tail ? Math.Max(0, initial.size - MaxBytes) : 0;
    }

    internal readonly record struct Stamp(string volumeId, string fileId, long size,
        string mtimeNs, string ctimeNs);

    private static Stamp Inspect(SafeFileHandle handle, string path, long maximum)
    {
        var value = Native.Inspect(handle, path, false);
        Native.Require(value.State.Length >= 0 && value.State.Length <= maximum);
        // FILE_BASIC_INFO Write/Change: 100ns ticks since 1601-01-01 UTC.
        // Keep checked integer decimal nanoseconds; never use Creation or a double.
        static string Ns(long ticks) => checked((checked((ulong)ticks) * 100))
            .ToString(CultureInfo.InvariantCulture);
        return new Stamp(value.Id.Volume.ToString("x16"),
            $"{value.Id.Low:x16}{value.Id.High:x16}", value.State.Length,
            Ns(value.Metadata.Write), Ns(value.Metadata.Change));
    }

    internal static ReadLease Open(string selected, bool tail = false)
    {
        Native.Require(OperatingSystem.IsWindows() && TargetPath.IsValid(selected));
        TargetPath? path = null;
        SafeFileHandle? handle = null;
        try
        {
            path = TargetPath.Pin(selected);
            // Exclude concurrent writers/deleters for the entire pass. Existing
            // active-writer handles must cause sharing refusal, never intervention.
            handle = Native.Open(selected, Native.Read, Native.ShareRead, false);
            var initial = Inspect(handle, selected, tail ? MaxTailFileBytes : MaxBytes);
            path.Validate();
            return new ReadLease(path, handle, initial, tail);
        }
        catch { handle?.Dispose(); path?.Dispose(); throw; }
    }

    internal Stamp Stat(bool freshPath)
    {
        Native.Require(!closed);
        path.Validate();
        Native.Require(Inspect(handle, path.Path, maxFileBytes) == initial);
        if (freshPath)
        {
            using var fresh = Native.Open(path.Path, Native.Read, Native.ShareRead, false);
            Native.Require(Inspect(fresh, path.Path, maxFileBytes) == initial);
            path.Validate();
        }
        return initial;
    }

    internal byte[] Read(int length, long offset)
    {
        Native.Require(!closed && !eof && length is > 0 and <= 64 * 1024 && offset == position);
        Native.Require(position <= initial.size);
        bool probe = position == initial.size;
        Native.Require(probe ? length == 1 : ++calls <= 16 &&
            length <= initial.size - position && length <= MaxBytes - returned);
        Stat(false);
        var bytes = new byte[length];
        try
        {
            int count = RandomAccess.Read(handle, bytes, offset);
            Native.Require(probe ? count == 0 : count > 0 && count <= length);
            returned += count;
            position += count;
            eof = probe;
            if (count == bytes.Length) return bytes;
            var result = bytes.AsSpan(0, count).ToArray();
            Array.Clear(bytes);
            return result;
        }
        catch { Array.Clear(bytes); throw; }
    }

    public void Dispose()
    {
        if (closed) return;
        closed = true;
        handle.Dispose();
        path.Dispose();
        Native.Require(handle.IsClosed);
    }
}
