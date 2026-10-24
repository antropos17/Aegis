using System.Runtime.InteropServices;
using System.Text.Json;
using Aegis.HookConfigTarget;
using Aegis.HookTransaction;
using Aegis.SessionContextReader;
using Microsoft.Win32.SafeHandles;

// Isolated large-file metadata/EOF fixture. The production project excludes it.
// Its caller supplies only a new, task-owned inert file through framed stdin.
if (args.Length != 0 || !OperatingSystem.IsWindows()) return 1;
try
{
    byte[] request = Wire.Read(Console.OpenStandardInput()) ?? throw new InvalidDataException();
    string selected;
    try
    {
        using var document = JsonDocument.Parse(request);
        Wire.Exact(document.RootElement, "path");
        selected = Wire.Text(document.RootElement, "path", 240);
    }
    finally { Array.Clear(request); }
    Native.Require(TargetPath.IsValid(selected));
    foreach (bool writeTime in new[] { true, false })
    {
        using var lease = ReadLease.Open(selected, true);
        Native.Require(lease.Stat(true).size > ReadLease.MaxBytes);
        using var attributes = Native.Open(selected, 0x100,
            Native.ShareRead | Native.ShareWrite | Native.ShareDelete, false);
        var original = Native.Inspect(attributes, selected, false);
        var metadata = writeTime
            ? new Native.Basic { Write = checked(original.Metadata.Write + 12345) }
            : new Native.Basic { Change = checked(original.Metadata.Change + 23456) };
        Native.Require(TailMetadataNative.SetBasic(attributes, 0, in metadata, 40));
        var changed = Native.Inspect(attributes, selected, false);
        Native.Require(writeTime ? changed.Metadata.Write != original.Metadata.Write :
            changed.Metadata.Write == original.Metadata.Write &&
            changed.Metadata.Change != original.Metadata.Change);
        bool refused = false;
        try { lease.Stat(false); }
        catch { refused = true; }
        Native.Require(refused);
    }
    int total = 0;
    using (var lease = ReadLease.Open(selected, true))
    {
        long size = lease.Stat(true).size;
        long position = Math.Max(0, size - ReadLease.MaxBytes);
        while (position < size)
        {
            byte[] content = lease.Read((int)Math.Min(64 * 1024, size - position), position);
            try { total += content.Length; position += content.Length; }
            finally { Array.Clear(content); }
        }
        Native.Require(total == ReadLease.MaxBytes);
        Native.Require(lease.Read(1, size).Length == 0);
        bool refused = false;
        try { lease.Read(1, size); }
        catch { refused = true; }
        Native.Require(refused);
    }
    Wire.Write(Console.OpenStandardOutput(), new
    {
        largeFileWriteMutationRefused = true,
        largeFileChangeMutationRefused = true,
        repeatedTailEofRefused = true,
        returnedBytes = total
    });
    return 0;
}
catch { return 1; }

internal static class TailMetadataNative
{
    [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true)]
    internal static extern bool SetBasic(SafeFileHandle file, int kind, in Native.Basic value, uint size);
}
