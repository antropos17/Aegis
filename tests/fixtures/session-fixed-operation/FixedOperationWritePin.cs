using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// The unchanged production share-read pin refuses an already writable mapping.
// This independent control uses no sharing or metadata relaxation.
internal sealed class FixedOperationWritePin : IDisposable
{
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle CreateFileMapping(SafeFileHandle file,
        IntPtr attributes, uint protection, uint high, uint low, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr MapViewOfFile(SafeFileHandle mapping, uint access, uint high, uint low, UIntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UnmapViewOfFile(IntPtr view);
    private readonly SafeFileHandle mapping;
    private readonly IntPtr view;
    private FixedOperationWritePin(string path)
    {
        using (var file = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite))
        { mapping = CreateFileMapping(file.SafeFileHandle, IntPtr.Zero, 4, 0, 0, null); CallerNative.Require(!mapping.IsInvalid); }
        view = MapViewOfFile(mapping, 2, 0, 0, UIntPtr.Zero); CallerNative.Require(view != IntPtr.Zero);
    }
    internal static FixedOperationWritePin Prepare(string root, string mode)
    { return mode == "fixed-writable-operation" ? new FixedOperationWritePin(Path.Combine(root, "registered-operation.json")) : null; }
    public void Dispose() { CallerNative.Require(UnmapViewOfFile(view)); mapping.Dispose(); }
}
