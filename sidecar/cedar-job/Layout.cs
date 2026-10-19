using System.Reflection;
using System.Security.Cryptography;

internal static class Layout
{
    private static string Value(string key) => Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>().Single(x => x.Key == key).Value ?? "";
    internal static (string Runtime, string Entry) Verified()
    {
        string runtime = Value("CedarRuntime"), entry = Value("CedarEntry"), asset = Value("CedarEntryAsset");
        Native.Check(Path.IsPathFullyQualified(runtime) && Path.IsPathFullyQualified(entry) && Path.IsPathFullyQualified(asset));
        CheckHash(runtime, Value("CedarRuntimeHash"));
        CheckHash(asset, Value("CedarEntryHash"));
        return (runtime, entry);
    }
    private static void CheckHash(string file, string expected)
    {
        Native.Check(expected.Length == 64 && expected.All(Uri.IsHexDigit));
        using var stream = File.OpenRead(file);
        Native.Check(Convert.ToHexString(SHA256.HashData(stream)).Equals(expected, StringComparison.OrdinalIgnoreCase));
        // Observation only: files/dependency folders must remain owner-trusted and stable.
        // A hash followed by path-based CreateProcess/require is not atomic authentication.
    }
}
