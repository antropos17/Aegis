using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

// Closed integrity grammar for one explicitly selected complete bundle.
public sealed class ProtectedGuiManifest
{
    public const string ProductExecutable = "AEGIS - AI Monitoring & Threat Detection.exe";
    public const int MaximumManifest = 524288, MaximumFiles = 1024, MaximumDirectories = 1024;
    public const long MaximumFile = 536870912, MaximumTotal = 2147483648;
    internal sealed class Row
    {
        internal readonly string Path, Hash; internal readonly long Bytes;
        internal Row(string path, long bytes, string hash) { Path = path; Bytes = bytes; Hash = hash; }
    }
    internal readonly string[] Directories;
    internal readonly Row[] Files;
    private readonly byte[] original;
    public string Digest { get; private set; }
    public int FileCount { get { return Files.Length; } }
    public long TotalBytes { get; private set; }
    private static readonly Regex PathGrammar = new Regex("\\A[A-Za-z0-9_.$@()+ &/-]{1,240}\\z", RegexOptions.CultureInvariant);
    private static readonly Regex Device = new Regex("\\A(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\\.|$)", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex DirectoryRow = new Regex("\\G\"([A-Za-z0-9_.$@()+ &/-]{1,240})\"", RegexOptions.CultureInvariant);
    private static readonly Regex FileRow = new Regex("\\G\\{\"path\":\"([A-Za-z0-9_.$@()+ &/-]{1,240})\",\"bytes\":(0|[1-9][0-9]{0,9}),\"sha256\":\"([a-f0-9]{64})\"\\}", RegexOptions.CultureInvariant);
    internal static void Need(bool value) { if (!value) throw new InvalidDataException("protected-gui-manifest-refused"); }
    internal static string Hash(byte[] bytes)
    { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    public static void ValidatePath(string value)
    {
        Need(value != null && PathGrammar.IsMatch(value)); string[] parts = value.Split('/'); Need(parts.Length <= 12);
        foreach (string part in parts) Need(part.Length > 0 && part != "." && part != ".." && part[0] != ' ' && part[0] != '.' &&
            part[part.Length - 1] != ' ' && part[part.Length - 1] != '.' && !Device.IsMatch(part));
    }
    private static void Literal(string text, ref int at, string expected)
    { Need(at <= text.Length - expected.Length && String.CompareOrdinal(text, at, expected, 0, expected.Length) == 0); at += expected.Length; }
    private ProtectedGuiManifest(byte[] bytes)
    {
        Need(bytes != null && bytes.Length > 0 && bytes.Length <= MaximumManifest);
        original = (byte[])bytes.Clone(); string text = new UTF8Encoding(false, true).GetString(original); int at = 0;
        Literal(text, ref at, "{\"schemaVersion\":1,\"scope\":\"protected-gui-bundle-candidate\",\"executable\":\"" + ProductExecutable + "\",\"directories\":[");
        var directories = new List<string>(); var files = new List<Row>();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var directoryNames = new HashSet<string>(StringComparer.Ordinal);
        string previous = null;
        while (at < text.Length && text[at] != ']')
        {
            Match entry = DirectoryRow.Match(text, at); Need(entry.Success && entry.Index == at); string path = entry.Groups[1].Value;
            ValidatePath(path); Need(names.Add(path) && (previous == null || String.CompareOrdinal(previous, path) < 0));
            previous = path; directories.Add(path); directoryNames.Add(path); Need(directories.Count <= MaximumDirectories); at += entry.Length;
            if (at < text.Length && text[at] == ',') { at++; Need(at < text.Length && text[at] != ']'); } else break;
        }
        Literal(text, ref at, "],\"files\":["); previous = null; long total = 0;
        while (at < text.Length && text[at] != ']')
        {
            Match entry = FileRow.Match(text, at); Need(entry.Success && entry.Index == at); string path = entry.Groups[1].Value; long size;
            ValidatePath(path); Need(names.Add(path) && (previous == null || String.CompareOrdinal(previous, path) < 0));
            Need(Int64.TryParse(entry.Groups[2].Value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out size) &&
                size >= 0 && size <= MaximumFile && size <= MaximumTotal - total);
            total += size; files.Add(new Row(path, size, entry.Groups[3].Value)); previous = path;
            Need(files.Count <= MaximumFiles); at += entry.Length;
            if (at < text.Length && text[at] == ',') { at++; Need(at < text.Length && text[at] != ']'); } else break;
        }
        Literal(text, ref at, "]}"); Need(at == text.Length && files.Count >= 2);
        bool executable = false, asar = false;
        foreach (Row file in files) { if (file.Path == ProductExecutable) executable = true; if (file.Path == "resources/app.asar") asar = true; }
        Need(executable && asar);
        foreach (string name in names)
        {
            int slash = name.LastIndexOf('/');
            if (slash >= 0) Need(directoryNames.Contains(name.Substring(0, slash)));
        }
        Directories = directories.ToArray(); Files = files.ToArray(); TotalBytes = total; Digest = Hash(original);
    }
    public static ProtectedGuiManifest Parse(byte[] bytes)
    {
        try { return new ProtectedGuiManifest(bytes); }
        catch { throw new InvalidDataException("protected-gui-manifest-refused"); }
    }
    internal byte[] CopyBytes() { return (byte[])original.Clone(); }
}
