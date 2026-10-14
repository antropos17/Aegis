using System;
using System.IO;
using System.Runtime.InteropServices;
using Aegis.ProtectedSession;
using Microsoft.Win32.SafeHandles;

// Disposable, unattached 8 MiB images. No VM, partition, mount or service changes.
internal static class VmDiskImageFixture
{
    internal static readonly string[] Cases = { "vhd-fixed", "vhd-dynamic", "vhdx-fixed", "vhdx-dynamic",
        "vhd-child", "vhdx-child", "vhd-missing-parent", "vhdx-missing-parent", "corrupt", "mislabel", "disposed" };
    internal static bool Elevated()
    {
        using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
            return new System.Security.Principal.WindowsPrincipal(identity).IsInRole(
                System.Security.Principal.WindowsBuiltInRole.Administrator);
    }
    private static int Main(string[] args)
    {
        if (args.Length != 2 || Array.IndexOf(Cases, args[0]) < 0 || !Elevated()) return 2;
        return Run(args[1], args[0]);
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct StorageType { internal uint Device; internal Guid Vendor; }
    [StructLayout(LayoutKind.Explicit, Size = 128)]
    private struct CreateParameters
    {
        [FieldOffset(0)] internal uint Version;
        [FieldOffset(8)] internal Guid Id;
        [FieldOffset(24)] internal ulong MaximumSize;
        [FieldOffset(32)] internal uint BlockSize;
        [FieldOffset(36)] internal uint SectorSize;
        [FieldOffset(40)] internal uint PhysicalSectorSize;
        [FieldOffset(48)] internal IntPtr Parent;
        [FieldOffset(56)] internal IntPtr Source;
    }
    [DllImport("virtdisk.dll", CharSet = CharSet.Unicode)]
    private static extern uint CreateVirtualDisk(ref StorageType type, string path, uint access,
        IntPtr security, uint flags, uint providerFlags, ref CreateParameters parameters,
        IntPtr overlapped, out IntPtr handle);
    private static void Create(string path, uint device, bool fixedSize, string parent)
    {
        var type = new StorageType(); type.Device = device;
        type.Vendor = new Guid("ec984aec-a0f9-47e9-901f-71415a66345b");
        var parameters = new CreateParameters(); parameters.Version = 2;
        parameters.MaximumSize = parent == null ? 8UL * 1024 * 1024 : 0;
        parameters.SectorSize = 512;
        parameters.Parent = parent == null ? IntPtr.Zero : Marshal.StringToHGlobalUni(parent);
        try
        {
            IntPtr raw;
            uint code = CreateVirtualDisk(ref type, path, 0, IntPtr.Zero,
                fixedSize ? 1U : 0U, 0, ref parameters, IntPtr.Zero, out raw);
            if (code != 0) throw new InvalidOperationException("fixture-create-" + code);
            using (var handle = new SafeFileHandle(raw, true))
                if (handle.IsInvalid) throw new InvalidOperationException("fixture-create-handle");
        }
        finally { if (parameters.Parent != IntPtr.Zero) Marshal.FreeHGlobal(parameters.Parent); }
    }
    internal static int Run(string root, string mode)
    {
        if (mode == "capability") { Console.WriteLine("{\"elevated\":" + (Elevated() ? "true" : "false") + "}"); return 0; }
        uint device = mode.StartsWith("vhdx-", StringComparison.Ordinal) ? 3U : 2U;
        string extension = device == 3 ? ".vhdx" : ".vhd";
        string disk = Path.Combine(root, "disk" + extension);
        string parent = Path.Combine(root, "parent" + extension);
        string renamed = Path.Combine(root, "original.bin");
        bool accepted = false, writeDenied = false;
        try
        {
            if (mode == "corrupt") File.WriteAllText(disk, "not a virtual disk");
            else if (mode.EndsWith("child", StringComparison.Ordinal) || mode.EndsWith("missing-parent", StringComparison.Ordinal))
            {
                Create(parent, device, false, null); Create(disk, device, false, parent);
                if (mode.EndsWith("missing-parent", StringComparison.Ordinal)) File.Delete(parent);
            }
            else Create(disk, device, mode.EndsWith("fixed", StringComparison.Ordinal), null);
            if (mode == "mislabel") { File.Move(disk, renamed); disk = Path.Combine(root, "disk.vhdx"); File.Copy(renamed, disk); }
            using (var held = new EnrollmentNative().Open(disk, false))
            {
                string metadata = held.BindingMetadata;
                if (mode == "disposed") held.Dispose();
                try { held.RequireStandaloneDisk(); accepted = true; } catch (InvalidDataException) { }
                if (mode != "disposed")
                {
                    held.Recheck(false);
                    if (held.BindingMetadata != metadata) throw new InvalidOperationException("fixture-image-changed");
                    try { using (var writer = new FileStream(disk, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) { } }
                    catch (IOException) { writeDenied = true; }
                }
            }
        }
        finally
        {
            File.Delete(disk); File.Delete(parent); File.Delete(renamed);
        }
        Console.WriteLine("{\"accepted\":" + (accepted ? "true" : "false") +
            ",\"writeDenied\":" + (writeDenied ? "true" : "false") + ",\"cleanup\":true}");
        return 0;
    }
}
