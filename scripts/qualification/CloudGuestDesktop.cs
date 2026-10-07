using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

// Trusted guest lab only. Never changes an inherited/interactive object's DACL.
internal sealed class CloudGuestDesktop : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct Attributes
    { public int Size; public IntPtr Descriptor; public int Inherit; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowStationW(string name, uint flags, uint access, ref Attributes attributes);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, ref Attributes attributes);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetProcessWindowStation(IntPtr station);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseWindowStation(IntPtr station);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
    private IntPtr station, desktop;
    internal readonly string Path;
    internal bool Restored { get; private set; }
    internal bool Closed { get; private set; }
    private static void Require(bool value, string code)
    { if (!value) throw new InvalidOperationException(code + ":" + Marshal.GetLastWin32Error()); }
    internal static string Descriptor(string expectedSid, bool windowStation)
    {
        var sid = new SecurityIdentifier(expectedSid);
        if (sid.Value != expectedSid || sid.AccountDomainSid == null) throw new InvalidOperationException("desktop-sid-invalid");
        // Parent admin and SYSTEM own the new objects. The task gets only
        // attributes/atoms on its private station; read/create/write objects on
        // its private desktop. No WRITE_DAC, WRITE_OWNER, clipboard or switching.
        return "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;" +
            (windowStation ? "0x22" : "0x83") + ";;;" + sid.Value + ")";
    }
    internal CloudGuestDesktop(string expectedSid)
    {
        Path = "AegisLab" + Guid.NewGuid().ToString("N") + "\\Default";
        IntPtr original = GetProcessWindowStation(), stationDescriptor = IntPtr.Zero, desktopDescriptor = IntPtr.Zero;
        bool changed = false, created = false;
        Require(original != IntPtr.Zero, "desktop-parent-station");
        try
        {
            uint bytes;
            Require(ConvertStringSecurityDescriptorToSecurityDescriptorW(Descriptor(expectedSid, true), 1, out stationDescriptor, out bytes), "desktop-station-descriptor");
            Require(ConvertStringSecurityDescriptorToSecurityDescriptorW(Descriptor(expectedSid, false), 1, out desktopDescriptor, out bytes), "desktop-object-descriptor");
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
            Restored = restored && GetProcessWindowStation() == original;
            if (stationDescriptor != IntPtr.Zero) LocalFree(stationDescriptor);
            if (desktopDescriptor != IntPtr.Zero) LocalFree(desktopDescriptor);
            if (!created) Dispose();
            if (!Restored) throw new InvalidOperationException("desktop-parent-restore");
        }
    }
    internal static void ProbeOwnerNode(Dictionary<string, object> receipt)
    {
        const string trusted = @"C:\ProgramData\AegisCloudLab\trusted";
        var process = new Process(); var watch = Stopwatch.StartNew(); bool started = false;
        receipt["ownerNodeVersionPassed"] = false;
        receipt["ownerNodeVersionExitObserved"] = false;
        try
        {
            process.StartInfo = new ProcessStartInfo(System.IO.Path.Combine(trusted, "node.exe"), "--version");
            process.StartInfo.UseShellExecute = false; process.StartInfo.CreateNoWindow = true;
            process.StartInfo.RedirectStandardOutput = true; process.StartInfo.RedirectStandardError = true;
            process.StartInfo.WorkingDirectory = trusted;
            process.StartInfo.EnvironmentVariables.Clear();
            process.StartInfo.EnvironmentVariables["SystemRoot"] = @"C:\Windows";
            process.StartInfo.EnvironmentVariables["TEMP"] = @"C:\AegisLab\scratch";
            process.StartInfo.EnvironmentVariables["TMP"] = @"C:\AegisLab\scratch";
            Require(process.Start(), "desktop-owner-node-start");
            started = true;
            var buffers = new byte[][] { new byte[129], new byte[1] };
            var streams = new System.IO.Stream[] { process.StandardOutput.BaseStream, process.StandardError.BaseStream };
            var reads = new Task<int>[] { streams[0].ReadAsync(buffers[0], 0, 129), streams[1].ReadAsync(buffers[1], 0, 1) };
            var counts = new int[2]; var ended = new bool[2];
            while (!process.HasExited || !ended[0] || !ended[1])
            {
                Require(watch.ElapsedMilliseconds < 3000, "desktop-owner-node-deadline");
                for (int i = 0; i < 2; i++)
                {
                    if (ended[i] || !reads[i].IsCompleted) continue;
                    int count = reads[i].GetAwaiter().GetResult();
                    if (count == 0) { ended[i] = true; continue; }
                    counts[i] += count;
                    Require(counts[i] <= (i == 0 ? 128 : 0), "desktop-owner-node-output");
                    reads[i] = streams[i].ReadAsync(buffers[i], counts[i], buffers[i].Length - counts[i]);
                }
                System.Threading.Thread.Sleep(1);
            }
            process.WaitForExit(); receipt["ownerNodeVersionExitCode"] = process.ExitCode;
            receipt["ownerNodeVersionExitObserved"] = true;
            Require(process.ExitCode == 0, "desktop-owner-node-exit");
            string version = new UTF8Encoding(false, true).GetString(buffers[0], 0, counts[0]);
            Require(Regex.IsMatch(version, "\\Av[0-9]{1,2}\\.[0-9]{1,3}\\.[0-9]{1,3}\\r?\\n\\z", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100)), "desktop-owner-node-version");
            receipt["ownerNodeVersion"] = version.TrimEnd('\r', '\n');
            receipt["ownerNodeVersionPassed"] = true;
        }
        finally
        {
            if (started && !process.HasExited) { process.Kill(); process.WaitForExit(1000); }
            process.Dispose(); watch.Stop();
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
    }
}
