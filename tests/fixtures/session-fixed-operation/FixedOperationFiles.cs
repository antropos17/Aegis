using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// Ordinary and metadata controls retain CompositionFiles' actual native pins.
// Exactly two byte-corruption controls share write access and omit metadata
// fencing to isolate the production reader's ORIGINAL BYTE comparison.
// Their held file IDs and reads remain native; this relaxation is reported.
internal sealed class FixedOperationFiles : IEnrollmentFiles, IDisposable
{
    private readonly CompositionFiles native;
    private readonly string mutable;
    internal FixedOperationFiles(string root, string mode)
    {
        native = new CompositionFiles(root) { BlockRoot = false };
        if (mode.EndsWith("-bytes", StringComparison.Ordinal))
            mutable = Path.Combine(root, mode == "fixed-operation-bytes" ? "registered-operation.json" : "fixed-fixture.json");
    }
    public EnrollmentHeld Open(string path, bool directory)
    { return path == mutable ? new MutableHeld(path) : native.Open(path, directory); }
    public void Dispose() { native.Dispose(); }
    private sealed class MutableHeld : EnrollmentHeld
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string path,
            uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, byte[] value, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileSizeEx(SafeFileHandle file, out long size);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetFilePointerEx(SafeFileHandle file, long distance, out long position, uint method);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadFile(SafeFileHandle file, byte[] value, uint size, out uint read, IntPtr overlapped);
        private readonly SafeFileHandle file;
        private readonly string path, volume, id;
        internal MutableHeld(string selected)
        {
            path = selected; file = CreateFile(path, 0x80020000, 3, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
            CallerNative.Require(!file.IsInvalid);
            byte[] identity = Identity(); volume = Hex(identity, 0, 8); id = Hex(identity, 8, 16); Recheck(false);
        }
        private byte[] Identity()
        { byte[] value = new byte[24]; CallerNative.Require(GetFileInformationByHandleEx(file, 18, value, 24)); return value; }
        private static string Hex(byte[] value, int start, int count)
        { return BitConverter.ToString(value, start, count).Replace("-", "").ToLowerInvariant(); }
        internal override string PathName { get { return path; } }
        internal override string Volume { get { return volume; } }
        internal override string FileId { get { return id; } }
        internal override bool Directory { get { return false; } }
        internal override bool Reparse { get { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0; } }
        internal override bool Protected(bool ancestor) { return true; }
        internal override byte[] Read(int maximum)
        {
            long size, position; uint read;
            CallerNative.Require(GetFileSizeEx(file, out size) && size > 0 && size <= maximum);
            byte[] bytes = new byte[checked((int)size)];
            CallerNative.Require(SetFilePointerEx(file, 0, out position, 0) && position == 0 &&
                ReadFile(file, bytes, (uint)bytes.Length, out read, IntPtr.Zero) && read == bytes.Length);
            return bytes;
        }
        internal override void Recheck(bool ancestor)
        {
            byte[] current = Identity();
            CallerNative.Require(!ancestor && !Reparse && volume == Hex(current, 0, 8) && id == Hex(current, 8, 16));
        }
        public override void Dispose() { file.Dispose(); }
    }
}
