using Microsoft.Win32.SafeHandles;

namespace Aegis.HookConfigTarget;

/// <summary>Fixed, disclosure-free outcomes. Only Written establishes verified after bytes.</summary>
public enum TargetCode { Ready, Written, Stale, Refused, InvalidInput, RetainedUnknown, Closed }

/// <summary>
/// A PRIVATE one-attempt capability for an explicitly trusted existing local NTFS file.
/// Keeps the original disk handle and ancestor handles alive through review.
/// This prerequisite supplies no private backup, authorization, installer or crash recovery.
/// </summary>
public sealed class TargetLease : IDisposable
{
    public const int MaxBytes = 256 * 1024;
    private readonly object gate = new();
    private readonly TargetPath path;
    private readonly SafeFileHandle retained;
    private readonly Native.Identity id;
    private readonly byte[] before;
    private bool closed;
    private TargetCode terminal = TargetCode.Closed;

    // Friend fixture seam runs within the real guard. No production callback API.
    internal Action? GuardHeldForTest { get; set; }
    internal Action<SafeFileHandle>? AfterWriteForTest { get; set; }

    private TargetLease(TargetPath path, SafeFileHandle retained, Native.Identity id, byte[] before)
    {
        this.path = path;
        this.retained = retained;
        this.id = id;
        this.before = before;
        Identity = $"{id.Volume:x16}:{id.Low:x16}{id.High:x16}";
    }

    /// <summary>Private identity token; never put in ordinary diagnostics, IPC or exports.</summary>
    public string Identity { get; }

    /// <summary>Returns a private copy of the reviewed bytes while the lease is open.</summary>
    public byte[] CopyBeforeBytes()
    {
        lock (gate) { ObjectDisposedException.ThrowIf(closed, this); return (byte[])before.Clone(); }
    }

    /// <summary>
    /// Captures bounded bytes under a temporary read guard and retains a shareable
    /// original handle afterward. Caller vouches for target ownership and selection.
    /// </summary>
    public static TargetCode Begin(string? trustedAbsolutePath, out TargetLease? lease)
    {
        lease = null;
        if (!OperatingSystem.IsWindows() || !TargetPath.IsValid(trustedAbsolutePath))
            return TargetCode.InvalidInput;
        TargetPath? pinned = null;
        SafeFileHandle? original = null;
        try
        {
            pinned = TargetPath.Pin(trustedAbsolutePath!);
            using var directoryGuard = pinned.Guard();
            original = Native.Open(pinned.Path, Native.Read,
                Native.ShareRead | Native.ShareWrite | Native.ShareDelete, false);
            var first = Native.Inspect(original, pinned.Path, false);
            using var guard = Native.Open(pinned.Path, Native.Read, Native.ShareRead, false);
            var guarded = Native.Inspect(guard, pinned.Path, false);
            Native.Require(guarded.Id == first.Id);
            pinned.Validate();
            byte[] bytes = Native.ReadExact(guard, guarded.State.Length);
            Native.Require(Native.Inspect(guard, pinned.Path, false).Id == first.Id);
            lease = new TargetLease(pinned, original, first.Id, bytes);
            return TargetCode.Ready;
        }
        catch { original?.Dispose(); pinned?.Dispose(); return TargetCode.Refused; }
    }

    /// <summary>
    /// Consumes a valid attempt. Compares the original object and exact reviewed
    /// bytes under a read/write handle that excludes write/delete sharing.
    /// Any possible mutation followed by failure is RetainedUnknown, never Stale.
    /// </summary>
    public TargetCode CompareAndWrite(string? expectedIdentity, byte[]? expectedBefore, byte[]? after)
    {
        lock (gate)
        {
            if (closed) return terminal;
            if (expectedIdentity != Identity || expectedBefore is null || after is null ||
                expectedBefore.Length > MaxBytes || after.Length > MaxBytes ||
                !expectedBefore.AsSpan().SequenceEqual(before)) return TargetCode.InvalidInput;
            byte[] replacement = (byte[])after.Clone();
            bool mayHaveMutated = false;
            TargetCode result;
            try
            {
                using var directoryGuard = path.Guard();
                using var guard = Native.Open(path.Path, Native.Read | Native.Write, Native.ShareRead, false);
                path.Validate();
                var current = Native.Inspect(guard, path.Path, false);
                // Original handle is retained: the old file ID cannot be recycled.
                if (current.Id != id || Native.Inspect(retained, path.Path, false).Id != id)
                    return Finish(TargetCode.Stale);
                if (!Native.ReadExact(guard, current.State.Length).AsSpan().SequenceEqual(before))
                    return Finish(TargetCode.Stale);
                GuardHeldForTest?.Invoke();
                // Set before the first mutating native call.
                mayHaveMutated = true;
                RandomAccess.Write(guard, replacement, 0);
                RandomAccess.SetLength(guard, replacement.Length);
                AfterWriteForTest?.Invoke(guard);
                RandomAccess.FlushToDisk(guard);
                Native.RestoreAttributes(guard, current.Metadata.Attributes);
                RandomAccess.FlushToDisk(guard);
                var written = Native.Inspect(guard, path.Path, false);
                Native.Require(written.Id == id && written.Metadata.Creation == current.Metadata.Creation &&
                    written.Metadata.Attributes == current.Metadata.Attributes);
                Native.Require(Native.ReadExact(guard, written.State.Length).AsSpan().SequenceEqual(replacement));
                path.Validate();
                result = TargetCode.Written;
            }
            catch { result = mayHaveMutated ? TargetCode.RetainedUnknown : TargetCode.Refused; }
            return Finish(result);
        }
    }

    private TargetCode Finish(TargetCode result)
    {
        terminal = result == TargetCode.RetainedUnknown ? result : TargetCode.Closed;
        Dispose();
        return result;
    }

    /// <summary>Releases all owned native handles; never rolls back target bytes.</summary>
    public void Dispose()
    {
        lock (gate)
        {
            if (closed) return;
            closed = true;
            retained.Dispose();
            path.Dispose();
            Array.Clear(before);
            GuardHeldForTest = null;
            AfterWriteForTest = null;
        }
    }
}
