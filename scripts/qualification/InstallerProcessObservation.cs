using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

// Read-only token evidence for the disposable guest's installer and Finish launch.
public static class InstallerProcessObservation {
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int needed);
    static IntPtr Read(IntPtr token, int kind) {
        int size; GetTokenInformation(token, kind, IntPtr.Zero, 0, out size);
        if (size < 4 || size > 65536) throw new InvalidOperationException("Unexpected token observation size");
        var data = Marshal.AllocHGlobal(size);
        if (!GetTokenInformation(token, kind, data, size, out size)) { Marshal.FreeHGlobal(data); throw new Win32Exception(); }
        return data;
    }
    public static Dictionary<string, object> Inspect(int pid) {
        var process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception();
        IntPtr token = IntPtr.Zero;
        try {
            if (!OpenProcessToken(process, 8, out token)) throw new Win32Exception();
            var result = new Dictionary<string, object> { { "pid", pid } };
            foreach (var pair in new[] { new KeyValuePair<int,string>(18,"elevationType"), new KeyValuePair<int,string>(20,"elevated") }) {
                var data = Read(token, pair.Key);
                try { result[pair.Value] = Marshal.ReadInt32(data); } finally { Marshal.FreeHGlobal(data); }
            }
            foreach (var pair in new[] { new KeyValuePair<int,string>(1,"userSid"), new KeyValuePair<int,string>(25,"integritySid") }) {
                var data = Read(token, pair.Key);
                try { result[pair.Value] = new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value; } finally { Marshal.FreeHGlobal(data); }
            }
            return result;
        } finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
}
