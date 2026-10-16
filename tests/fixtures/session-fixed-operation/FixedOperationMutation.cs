using System;
using System.IO;

// Actual file bytes change. Only two corruption fixtures use the explicitly
// relaxed sharing/metadata adapter in FixedOperationFiles.
internal sealed class FixedOperationMutation : IDisposable
{
    private readonly string path;
    private readonly byte[] original;
    private FixedOperationMutation(string selected) { path = selected; original = File.ReadAllBytes(path); }
    internal static FixedOperationMutation Prepare(string root, string mode)
    {
        if (!mode.EndsWith("-bytes", StringComparison.Ordinal)) return null;
        return new FixedOperationMutation(Path.Combine(root, mode == "fixed-operation-bytes" ? "registered-operation.json" : "fixed-fixture.json"));
    }
    internal void Change()
    { byte[] changed = (byte[])original.Clone(); changed[changed.Length - 1] ^= 1; File.WriteAllBytes(path, changed); }
    internal void Restore() { File.WriteAllBytes(path, original); }
    public void Dispose() { Restore(); }
}
