using System.Runtime.InteropServices;
using System.Text;

namespace Aegis.EtwLifecycle;

// A lexical retention boundary, not an assertion about reparse targets or ownership.
internal sealed class FileScope
{
    private static readonly UTF8Encoding Utf8 = new(false, true);
    internal string Root { get; }
    private readonly string[] prefixes;
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint QueryDosDevice(string name, StringBuilder target, int size);
    internal FileScope(string root, bool queryDevice = true)
    {
        if (root.Length < 4 || !char.IsAsciiLetter(root[0]) || root[1] != ':' || root[2] != '\\' ||
            root.Length > 1024 || root.Any(char.IsControl) || root[3..].Contains(':') || root.Contains('/') ||
            root.Split('\\').Skip(1).Any(v => v is "." or ".." || v.EndsWith(' ') || v.EndsWith('.')))
            throw new ArgumentException();
        Root = root.TrimEnd('\\');
        if (Root.Length < 4) throw new ArgumentException(); // Never a whole drive.
        var list = new List<string> { Root, @"\??\" + Root, @"\\?\" + Root };
        if (queryDevice)
        {
            var target = new StringBuilder(32768);
            if (QueryDosDevice(Root[..2], target, target.Capacity) == 0) throw new InvalidOperationException();
            list.Add(target + Root[2..]);
        }
        prefixes = list.ToArray();
    }
    internal string? Select(string? name)
    {
        if (name == null || name.Length > 32768 || name.Any(char.IsControl)) return null;
        try { if (Utf8.GetByteCount(name) > 32768) return null; }
        catch (EncoderFallbackException) { return null; }
        if (name.Split('\\').Any(v => v is "." or "..")) return null;
        foreach (var prefix in prefixes)
            if (name.StartsWith(prefix + "\\", StringComparison.OrdinalIgnoreCase))
            {
                string selected = Root + name[prefix.Length..];
                return Utf8.GetByteCount(selected) <= 32768 ? selected : null;
            }
        return null;
    }
}
