using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

// Trusted guest administrative bootstrap only. Never changes an inherited/interactive object's DACL.
internal sealed class ProtectedGuestDesktop : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct Attributes
    { public int Size; public IntPtr Descriptor; public int Inherit; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowStationW(string name, uint flags, uint access, ref Attributes attributes);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, ref Attributes attributes);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetProcessWindowStation();
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetProcessWindowStation(IntPtr station);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseWindowStation(IntPtr station);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
    private IntPtr station, desktop;
    internal readonly string Path;
    internal bool Restored { get; private set; }
    internal bool ThreadDesktopPreserved { get; private set; }
    internal bool Closed { get; private set; }
    private static void Require(bool value, string code)
    { if (!value) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), code); }
    internal static string Descriptor(string expectedSid, bool windowStation)
    { return Descriptor(expectedSid, windowStation, false); }
    internal static string Descriptor(string expectedSid, bool windowStation, bool documented)
    {
        var sid = new SecurityIdentifier(expectedSid);
        if (sid.Value != expectedSid || sid.AccountDomainSid == null) throw new InvalidOperationException("desktop-sid-invalid");
        // Private guest profiles apply only to fresh task-exclusive noninteractive objects.
        // The documented profile includes STANDARD_RIGHTS_REQUIRED (including
        // WRITE_DAC/WRITE_OWNER). No inherited/default object receives this ACE.
        return "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;" +
            (documented ? (windowStation ? "0xf006e" : "0xf00cf") : (windowStation ? "0x22" : "0x83")) + ";;;" + sid.Value + ")";
    }
    internal ProtectedGuestDesktop(string expectedSid) : this(expectedSid, false) { }
    internal ProtectedGuestDesktop(string expectedSid, bool documented)
    {
        Path = "AegisGuest" + Guid.NewGuid().ToString("N") + "\\Default";
        IntPtr original = GetProcessWindowStation(), stationDescriptor = IntPtr.Zero, desktopDescriptor = IntPtr.Zero;
        IntPtr originalThreadDesktop = GetThreadDesktop(GetCurrentThreadId());
        Require(originalThreadDesktop != IntPtr.Zero, "desktop-parent-thread");
        bool changed = false, created = false;
        Require(original != IntPtr.Zero, "desktop-parent-station");
        try
        {
            uint bytes;
            Require(ConvertStringSecurityDescriptorToSecurityDescriptorW(Descriptor(expectedSid, true, documented), 1, out stationDescriptor, out bytes), "desktop-station-descriptor");
            Require(ConvertStringSecurityDescriptorToSecurityDescriptorW(Descriptor(expectedSid, false, documented), 1, out desktopDescriptor, out bytes), "desktop-object-descriptor");
            var attributes = new Attributes(); attributes.Size = Marshal.SizeOf(typeof(Attributes)); attributes.Descriptor = stationDescriptor;
            // CWF_CREATE_ONLY refuses an existing named station. Never adopt it.
            station = CreateWindowStationW(Path.Split('\\')[0], 1, 0x000F037F, ref attributes);
            Require(station != IntPtr.Zero, "desktop-station-create");
            Require(SetProcessWindowStation(station), "desktop-station-select"); changed = true;
            attributes.Descriptor = desktopDescriptor;
            desktop = CreateDesktopW("Default", IntPtr.Zero, IntPtr.Zero, 0, 0x000F01FF, ref attributes);
            Require(desktop != IntPtr.Zero, "desktop-object-create");
            created = true;
        }
        finally
        {
            bool restored = !changed || SetProcessWindowStation(original);
            ThreadDesktopPreserved = GetThreadDesktop(GetCurrentThreadId()) == originalThreadDesktop;
            Restored = restored && GetProcessWindowStation() == original && ThreadDesktopPreserved;
            if (stationDescriptor != IntPtr.Zero) LocalFree(stationDescriptor);
            if (desktopDescriptor != IntPtr.Zero) LocalFree(desktopDescriptor);
            if (!created) Dispose();
            if (!Restored) throw new InvalidOperationException("desktop-parent-restore");
        }
    }
    public void Dispose()
    {
        // Call only after the retained task Job is confirmed closed. Handle
        // closure alone is not proof that no other process holds a desktop.
        bool desktopClosed = desktop == IntPtr.Zero || CloseDesktop(desktop);
        bool stationClosed = station == IntPtr.Zero || CloseWindowStation(station);
        if (desktopClosed) desktop = IntPtr.Zero;
        if (stationClosed) station = IntPtr.Zero;
        Closed = desktopClosed && stationClosed;
        if (!Closed) throw new InvalidOperationException("protected-guest-desktop-close-refused");
    }
}
