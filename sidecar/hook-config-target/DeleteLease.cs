using Microsoft.Win32.SafeHandles;

namespace Aegis.HookConfigTarget;

/// <summary>Outcomes for one selected-file deletion attempt.</summary>
public enum DeleteCode { Ready, Deleted, Refused, Unknown, Closed }

/// <summary>Private one-attempt capability tied to the selected NTFS file and its ancestors.</summary>
public sealed class DeleteLease : IDisposable
{
    private readonly TargetPath path;
    private readonly SafeFileHandle file;
    private readonly Native.Identity id;
    private readonly Native.Basic before;
    private readonly long length;
    private bool closed;

    private DeleteLease(TargetPath path, SafeFileHandle file, Native.Identity id, Native.Basic before, long length)
    { this.path = path; this.file = file; this.id = id; this.before = before; this.length = length; }

    /// <summary>Retains the selected object before owner review, without altering it.</summary>
    public static DeleteCode Begin(string? selected, out DeleteLease? lease)
    {
        lease = null;
        if (!OperatingSystem.IsWindows() || !TargetPath.IsValid(selected)) return DeleteCode.Refused;
        TargetPath? pinned = null;
        SafeFileHandle? file = null;
        try
        {
            pinned = TargetPath.Pin(selected!, retainDirectoryRead: true);
            using var guard = pinned.Guard();
            file = Native.Open(pinned.Path, Native.Delete | Native.ReadAttributes, Native.ShareRead, false);
            var first = Native.Inspect(file, pinned.Path, false);
            pinned.Validate();
            lease = new DeleteLease(pinned, file, first.Id, first.Metadata, first.State.Length);
            return DeleteCode.Ready;
        }
        catch { file?.Dispose(); pinned?.Dispose(); return DeleteCode.Refused; }
    }

    /// <summary>Consumes the capability and marks only the retained object for deletion.</summary>
    public DeleteCode Delete()
    {
        if (closed) return DeleteCode.Closed;
        bool mayHaveMutated = false;
        try
        {
            using var guard = path.Guard();
            path.Validate();
            var current = Native.Inspect(file, path.Path, false);
            if (current.Id != id || current.State.Length != length ||
                current.Metadata.Creation != before.Creation || current.Metadata.Write != before.Write ||
                current.Metadata.Change != before.Change || current.Metadata.Attributes != before.Attributes)
                return DeleteCode.Refused;
            using (var check = Native.Open(path.Path, Native.ReadAttributes,
                Native.ShareRead | Native.ShareDelete, false))
                if (Native.Inspect(check, path.Path, false).Id != id) return DeleteCode.Refused;
            mayHaveMutated = true;
            Native.MarkDelete(file);
            file.Dispose();
            return Native.DefinitelyAbsent(path.Path) ? DeleteCode.Deleted : DeleteCode.Unknown;
        }
        catch { return mayHaveMutated ? DeleteCode.Unknown : DeleteCode.Refused; }
        finally { Dispose(); }
    }

    /// <summary>Closes retained handles without issuing deletion.</summary>
    public void Dispose()
    {
        if (closed) return;
        closed = true;
        file.Dispose();
        path.Dispose();
    }
}
