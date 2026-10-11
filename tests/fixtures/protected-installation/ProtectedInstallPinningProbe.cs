using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// Only fixed read/delete probes are exposed; the caller creates every target.
public static class ProtectedInstallPinningProbe
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
        IntPtr security, uint create, uint flags, IntPtr template);

    private static int Open(string path, uint access)
    {
        using (SafeFileHandle held = CreateFile(path, access, 1, IntPtr.Zero, 3,
            0x02200000, IntPtr.Zero)) {
            return held.IsInvalid ? Marshal.GetLastWin32Error() : 0;
        }
    }
    public static int ReadPinError(string path) { return Open(path, 0x20080); }
    public static int DeletePinError(string path) { return Open(path, 0x10000); }
    public static int WritePinError(string path) { return Open(path, 0x40000000); }
    public static bool MaintainedEnrollmentMatches(string path, string volume, string fileId)
    {
        using (EnrollmentHeld reader = new EnrollmentNative().Open(path, true)) {
            reader.Recheck(false);
            return reader.Directory && !reader.Reparse && reader.PathName == path &&
                reader.Volume == volume && reader.FileId == fileId;
        }
    }
}
