using System.Runtime.InteropServices;
using System.Text.Json;
using Aegis.HookConfigTarget;
using Aegis.HookTransaction;
using Aegis.SessionContextReader;
using Microsoft.Win32.SafeHandles;

// Disposable, isolated metadata-mutating fixture. This program is excluded from
// the production reader project and receives only a newly owned inert file.
if (args.Length != 0 || !OperatingSystem.IsWindows()) return 1;
try
{
    byte[] bytes = Wire.Read(Console.OpenStandardInput()) ?? throw new InvalidDataException();
    string selected;
    try
    {
        using var document = JsonDocument.Parse(bytes);
        Wire.Exact(document.RootElement, "path");
        selected = Wire.Text(document.RootElement, "path", 240);
    }
    finally { Array.Clear(bytes); }
    Native.Require(TargetPath.IsValid(selected));
    foreach (bool writeTime in new[] { true, false })
    {
        using var lease = ReadLease.Open(selected);
        var initial = lease.Stat(true);
        using var attributes = Native.Open(selected, 0x100,
            Native.ShareRead | Native.ShareWrite | Native.ShareDelete, false);
        var original = Native.Inspect(attributes, selected, false);
        var metadata = writeTime
            ? new Native.Basic { Write = checked(original.Metadata.Write + 12345) }
            : new Native.Basic { Change = checked(original.Metadata.Change + 23456) };
        Native.Require(MetadataNative.SetBasic(attributes, 0, in metadata, 40));
        var changed = Native.Inspect(attributes, selected, false);
        Native.Require(writeTime ? changed.Metadata.Write != original.Metadata.Write :
            changed.Metadata.Write == original.Metadata.Write && changed.Metadata.Change != original.Metadata.Change);
        bool refused = false;
        try { lease.Stat(false); }
        catch { refused = true; }
        Native.Require(refused);
    }
    using (var lease = ReadLease.Open(selected))
    {
        int size = checked((int)lease.Stat(true).size);
        byte[] content = lease.Read(size, 0);
        try { Native.Require(content.Length == size); }
        finally { Array.Clear(content); }
        Native.Require(lease.Read(1, size).Length == 0);
        bool refused = false;
        try { lease.Read(1, size); }
        catch { refused = true; }
        Native.Require(refused);
    }
    Wire.Write(Console.OpenStandardOutput(), new { writeMutationRefused = true,
        changeOnlyMutationRefused = true, repeatedEofRefused = true });
    return 0;
}
catch { return 1; }

internal static class MetadataNative
{
    [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true)]
    internal static extern bool SetBasic(SafeFileHandle file, int kind, in Native.Basic value, uint size);
}
