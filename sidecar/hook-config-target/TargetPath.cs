using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Aegis.HookConfigTarget;

internal sealed class TargetPath : IDisposable
{
    private readonly List<(string Path, SafeFileHandle Handle, Native.Identity Id)> parents = [];
    internal string Path { get; }

    private TargetPath(string path) => Path = path;

    internal static bool IsValid(string? path)
    {
        if (path is null || path.Length is < 4 or > 240 ||
            !Regex.IsMatch(path, @"^[A-Z]:\\", RegexOptions.CultureInvariant)) return false;
        if (path.AsSpan(3).ContainsAny("/<>:\"|?*~")) return false;
        foreach (string part in path[3..].Split('\\'))
        {
            if (part.Length == 0 || part.EndsWith(' ') || part.EndsWith('.') ||
                part.Any(c => c < 32 || c == 127)) return false;
            string stem = part.Split('.')[0];
            if (Regex.IsMatch(stem, @"^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])$",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) return false;
        }
        return true;
    }

    internal static TargetPath Pin(string path, bool retainDirectoryRead = false)
    {
        var pinned = new TargetPath(path);
        try
        {
            string root = path[..3];
            Native.Require(Native.GetDriveTypeW(root) == 3);
            pinned.Add(root, retainDirectoryRead);
            string current = root[..2];
            string[] parts = path[3..].Split('\\');
            foreach (string part in parts[..^1])
            {
                current += "\\" + part;
                pinned.Add(current, retainDirectoryRead);
            }
            return pinned;
        }
        catch { pinned.Dispose(); throw; }
    }

    private void Add(string path, bool retainDirectoryRead)
    {
        // Retain ancestor identity and exclude ancestor rename/delete. Directory
        // writes remain shareable during review so ordinary target replacement
        // is possible; Guard() excludes them during snapshot/commit operations.
        // Attribute-only handles do not necessarily prevent directory rename on
        // Windows. A selected scope requires a data-access handle throughout review.
        var handle = Native.Open(path, retainDirectoryRead ? Native.Read : Native.ReadAttributes,
            Native.ShareRead | Native.ShareWrite, true);
        try { parents.Add((path, handle, Native.Inspect(handle, path, true).Id)); }
        catch { handle.Dispose(); throw; }
    }

    internal void Validate()
    {
        foreach (var parent in parents)
            Native.Require(Native.Inspect(parent.Handle, parent.Path, true).Id == parent.Id);
    }

    internal IDisposable Guard()
    {
        var handles = new List<SafeFileHandle>();
        try
        {
            foreach (var parent in parents)
            {
                var handle = Native.Open(parent.Path, Native.Read, Native.ShareRead, true);
                handles.Add(handle);
                Native.Require(Native.Inspect(handle, parent.Path, true).Id == parent.Id);
            }
            return new DirectoryGuard(handles);
        }
        catch { foreach (var handle in handles) handle.Dispose(); throw; }
    }

    private sealed class DirectoryGuard(List<SafeFileHandle> handles) : IDisposable
    {
        public void Dispose() { foreach (var handle in handles.AsEnumerable().Reverse()) handle.Dispose(); }
    }

    public void Dispose()
    {
        foreach (var parent in parents.AsEnumerable().Reverse()) parent.Handle.Dispose();
        parents.Clear();
    }
}
