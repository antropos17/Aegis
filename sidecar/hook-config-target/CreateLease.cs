using Microsoft.Win32.SafeHandles;

namespace Aegis.HookConfigTarget;

/// <summary>One create-only attempt under retained target and selected scope ancestors.</summary>
public sealed class CreateLease : IDisposable
{
    public const int MaxBytes = 65536;
    private readonly TargetPath target;
    private readonly TargetPath scope;
    private SafeFileHandle? file;
    private Native.Identity identity;
    private byte[]? written;
    private bool attempted;
    private bool closed;

    internal Action<SafeFileHandle>? AfterWriteForTest { get; set; }

    private CreateLease(TargetPath target, TargetPath scope)
    { this.target = target; this.scope = scope; }

    /// <summary>Pins existing directories before review; never creates the target.</summary>
    public static TargetCode Begin(string? targetPath, string? scopePath, out CreateLease? lease)
    {
        lease = null;
        if (!OperatingSystem.IsWindows() || !TargetPath.IsValid(targetPath) || scopePath is null)
            return TargetCode.InvalidInput;
        // Pin includes every parent of the synthetic child, including scope itself.
        string scopeChild = scopePath.EndsWith('\\') ? scopePath + "aegis-scope-witness" :
            scopePath + "\\aegis-scope-witness";
        if (!TargetPath.IsValid(scopeChild)) return TargetCode.InvalidInput;
        TargetPath? target = null, scope = null;
        try
        {
            target = TargetPath.Pin(targetPath!, retainDirectoryRead: true);
            scope = TargetPath.Pin(scopeChild, retainDirectoryRead: true);
            using var targetGuard = target.Guard();
            using var scopeGuard = scope.Guard();
            target.Validate(); scope.Validate();
            lease = new CreateLease(target, scope);
            return TargetCode.Ready;
        }
        catch { scope?.Dispose(); target?.Dispose(); return TargetCode.Refused; }
    }

    /// <summary>Create a new target once. Any failure after creation is retained unknown.</summary>
    public TargetCode Create(byte[]? bytes)
    {
        if (closed || attempted) return TargetCode.Closed;
        if (bytes is null || bytes.Length > MaxBytes) return TargetCode.InvalidInput;
        attempted = true;
        byte[] expected = (byte[])bytes.Clone();
        bool created = false;
        try
        {
            using var targetGuard = target.Guard();
            using var scopeGuard = scope.Guard();
            target.Validate(); scope.Validate();
            file = Native.CreateNew(target.Path);
            created = true;
            var initial = Native.Inspect(file, target.Path, false);
            identity = initial.Id;
            RandomAccess.Write(file, expected, 0);
            RandomAccess.SetLength(file, expected.Length);
            AfterWriteForTest?.Invoke(file);
            RandomAccess.FlushToDisk(file);
            var current = Native.Inspect(file, target.Path, false);
            Native.Require(current.Id == identity && Native.ReadExact(file, current.State.Length).AsSpan().SequenceEqual(expected));
            target.Validate(); scope.Validate();
            written = expected;
            return TargetCode.Written;
        }
        catch
        {
            Array.Clear(expected);
            file?.Dispose(); file = null;
            return created ? TargetCode.RetainedUnknown : TargetCode.Refused;
        }
    }

    /// <summary>Recheck held object and scope immediately before profile commit.</summary>
    public TargetCode Check()
    {
        if (closed || file is null || written is null) return TargetCode.Closed;
        try
        {
            using var targetGuard = target.Guard();
            using var scopeGuard = scope.Guard();
            target.Validate(); scope.Validate();
            var current = Native.Inspect(file, target.Path, false);
            Native.Require(current.Id == identity && Native.ReadExact(file, current.State.Length).AsSpan().SequenceEqual(written));
            target.Validate(); scope.Validate();
            return TargetCode.Ready;
        }
        catch { return TargetCode.Stale; }
    }

    public void Dispose()
    {
        if (closed) return;
        closed = true;
        file?.Dispose();
        if (written is not null) Array.Clear(written);
        scope.Dispose(); target.Dispose();
    }
}
