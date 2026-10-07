using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

// Standalone harmless current-principal fixture, no credentials or default DACL changes.
internal static class CloudGuestDesktopFixture
{
    private static string nodeImage, fixtureDirectory;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    {
        public int Size; public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedLength; public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Info { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out Info info);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] private static extern uint ResumeThread(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr handle, uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetProcessWindowStation();
    [DllImport("kernel32.dll")] private static extern uint SetErrorMode(uint mode);
    [StructLayout(LayoutKind.Sequential)] private struct Attributes { public int Size; public IntPtr Descriptor; public int Inherit; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, ref Attributes attributes);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseDesktop(IntPtr handle);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint length, out uint needed);
    private static uint PrivateDesktop(string sid, bool deny)
    {
        string name = "AegisFixture" + Guid.NewGuid().ToString("N");
        IntPtr descriptor = IntPtr.Zero, desktop = IntPtr.Zero;
        try
        {
            uint size;
            string sddl = "D:P" + (deny ? "(D;;0x83;;;" + sid + ")" : "") + "(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x83;;;" + sid + ")";
            if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out descriptor, out size)) throw new InvalidOperationException("fixture-descriptor");
            var attributes = new Attributes(); attributes.Size = Marshal.SizeOf(typeof(Attributes)); attributes.Descriptor = descriptor;
            desktop = CreateDesktopW(name, IntPtr.Zero, IntPtr.Zero, 0, 0x83, ref attributes);
            if (desktop == IntPtr.Zero) {
                if (deny && Marshal.GetLastWin32Error() == 5) return 5;
                throw new InvalidOperationException("fixture-desktop-create:" + Marshal.GetLastWin32Error());
            }
            var stationName = new StringBuilder(256); uint needed;
            if (!GetUserObjectInformationW(GetProcessWindowStation(), 2, stationName, 512, out needed)) throw new InvalidOperationException("fixture-station-name");
            return Node(stationName.ToString() + "\\" + name);
        }
        finally { if (desktop != IntPtr.Zero && !CloseDesktop(desktop)) throw new InvalidOperationException("fixture-desktop-close"); if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    private static uint Node(string desktop)
    {
        string image = nodeImage;
        var startup = new Startup(); startup.Size = Marshal.SizeOf(typeof(Startup)); startup.Desktop = desktop;
        Info child = new Info();
        try
        {
            if (!CreateProcessW(image, new StringBuilder("\"" + image + "\" --version"), IntPtr.Zero, IntPtr.Zero, false, 0x08000004, IntPtr.Zero, fixtureDirectory, ref startup, out child))
                throw new InvalidOperationException("fixture-create:" + Marshal.GetLastWin32Error());
            if (ResumeThread(child.Thread) != 1 || WaitForSingleObject(child.Process, 3000) != 0)
                throw new InvalidOperationException("fixture-child-unsettled");
            uint code; if (!GetExitCodeProcess(child.Process, out code)) throw new InvalidOperationException("fixture-exit-missing");
            return code;
        }
        finally
        {
            if (child.Process != IntPtr.Zero) { if (WaitForSingleObject(child.Process, 0) != 0) { TerminateProcess(child.Process, 137); WaitForSingleObject(child.Process, 1000); } CloseHandle(child.Process); }
            if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
        }
    }
    private static int Main(string[] arguments)
    {
        SetErrorMode(1 | 2);
        try
        {
            if (arguments.Length != 1 || !System.IO.Path.IsPathRooted(arguments[0]) ||
                !System.IO.Path.GetFileName(arguments[0]).Equals("node.exe", StringComparison.OrdinalIgnoreCase) ||
                arguments[0].Length > 260 || arguments[0].IndexOf('"') >= 0 || arguments[0].StartsWith(@"\\")) return 2;
            nodeImage = arguments[0];
            fixtureDirectory = System.IO.Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            var directory = new System.IO.DirectoryInfo(fixtureDirectory);
            if (!directory.Exists || !directory.Name.StartsWith("aegis-guest-desktop-", StringComparison.Ordinal) ||
                fixtureDirectory.Length > 260 || fixtureDirectory.StartsWith(@"\\") || fixtureDirectory.IndexOf('"') >= 0) return 2;
            for (var current = directory; current != null; current = current.Parent)
                if ((current.Attributes & System.IO.FileAttributes.ReparsePoint) != 0) return 2;
            string sid = WindowsIdentity.GetCurrent().User.Value;
            uint baseline = Node(null);
            IntPtr original = GetProcessWindowStation();
            uint privateDesktop = PrivateDesktop(sid, false), deniedDesktop = PrivateDesktop(sid, true);
            Console.WriteLine("{\"baselineExit\":" + baseline + ",\"privateDesktopExit\":" + privateDesktop + ",\"negativeDesktopExitOrAccess\":" + deniedDesktop + "}");
            if (baseline != 0 || privateDesktop != 0 || (deniedDesktop != 5 && deniedDesktop != 0xC0000142) || original != GetProcessWindowStation()) return 1;
            try
            {
                using (var owner = new CloudGuestDesktop(sid))
                {
                    uint code = Node(owner.Path);
                    bool restored = owner.Restored && original == GetProcessWindowStation();
                    owner.Dispose();
                    Console.WriteLine("{\"baselineExit\":0,\"privateDesktopExit\":0,\"negativeDesktopAccess\":5,\"privateStationExit\":" + code + ",\"parentRestored\":" + (restored ? "true" : "false") + ",\"handlesClosed\":" + (owner.Closed ? "true" : "false") + "}");
                    return code == 0 && restored && owner.Closed ? 0 : 1;
                }
            }
            catch (InvalidOperationException error) {
                if (error.Message != "desktop-station-create:5") throw;
                Console.WriteLine("{\"privateStationAvailable\":false,\"win32Error\":5,\"parentRestored\":" + (original == GetProcessWindowStation() ? "true" : "false") + "}"); return 0;
            }
        }
        catch (Exception error)
        { Console.WriteLine("{\"fixtureFailed\":true,\"hResult\":" + error.HResult + ",\"win32Error\":" + Marshal.GetLastWin32Error() + "}"); return 2; }
    }
}
