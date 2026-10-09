using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class BootstrapChild
{
    [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(SafeFileHandle process, uint code);
    [StructLayout(LayoutKind.Sequential)] private struct ObjectBasicInformation
    {
        public uint Attributes, GrantedAccess, HandleCount, PointerCount;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 10)] public uint[] Reserved;
    }
    [DllImport("ntdll.dll")] private static extern int NtQueryObject(SafeFileHandle handle, int kind,
        out ObjectBasicInformation data, int size, out int returned);
    private static void Save(string control, string json)
    {
        if (Environment.GetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_HOLD_WRITER") == "1")
        {
            using (var file = new FileStream(Path.Combine(control, "observed.json"), FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var writer = new StreamWriter(file))
            {
                writer.Write(json); writer.Flush();
                LauncherObservation.Until(() => File.Exists(Path.Combine(control, "parent-read-attempted")), "observation-parent-read-timeout");
                Thread.Sleep(50);
            }
            return;
        }
        File.WriteAllText(Path.Combine(control, "observed.tmp"), json);
        File.Move(Path.Combine(control, "observed.tmp"), Path.Combine(control, "observed.json"));
    }
    private static int Main()
    {
        string control = Environment.GetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CONTROL");
        int step = 0;
        var timer = Stopwatch.StartNew(); bool canaryExcluded = false;
        try
        {
            using (var canary = new SafeFileHandle(new IntPtr(long.Parse(Environment.GetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CANARY_HANDLE"))), false))
            {
                LauncherObservation.FileInfo observed;
                canaryExcluded = !LauncherObservation.GetFileInformationByHandle(canary, out observed) ||
                    observed.Identity != Environment.GetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CANARY_ID");
                CallerNative.Require(canaryExcluded);
            }
            File.WriteAllText(Path.Combine(control, "std.txt"), "in=" + GetStdHandle(-10) + ";out=" + GetStdHandle(-11) + ";err=" + GetStdHandle(-12));
            CallerNative.Require(GetStdHandle(-11) == new IntPtr(-1) && GetStdHandle(-12) == new IntPtr(-1));
            step = 1;
            File.WriteAllText(Path.Combine(control, "receiver-entered.tmp"), Process.GetCurrentProcess().Id.ToString());
            File.Move(Path.Combine(control, "receiver-entered.tmp"), Path.Combine(control, "receiver-entered.pid"));
            var frame = CallerBootstrapInput.Receive(500);
            step = 2;
            bool rights;
            using (var imported = new SafeFileHandle(frame.ServerHandle, false))
            {
                    int returned; ObjectBasicInformation info;
                    int queryStatus = NtQueryObject(imported, 0, out info, Marshal.SizeOf(typeof(ObjectBasicInformation)), out returned);
                    rights = queryStatus == 0 && info.GrantedAccess == 0x00101000;
                    if (!rights) File.WriteAllText(Path.Combine(control, "rights.txt"), "status=" + queryStatus.ToString("x") +
                        ";returned=" + returned + ";rights=" + info.GrantedAccess.ToString("x"));
                    CallerNative.Require(rights && !TerminateProcess(imported, 0) && Marshal.GetLastWin32Error() == 5);
            }
            step = 3;
            using (var server = frame.ImportServer())
            {
                step = 4;
                using (var pipe = CallerEndpoint.ConnectLocal(frame.Locator, server, 1000))
                {
                step = 5;
                string json = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"operation\":\"inspect-owned\",\"requestId\":\"" +
                    new string('c', 32) + "\",\"sessionId\":\"" + frame.Session + "\",\"generation\":\"" + frame.Generation + "\",\"sequence\":1}";
                byte[] body = Encoding.UTF8.GetBytes(json), bytes = new byte[body.Length + 4]; uint written;
                Buffer.BlockCopy(BitConverter.GetBytes(body.Length), 0, bytes, 0, 4); Buffer.BlockCopy(body, 0, bytes, 4, body.Length);
                CallerNative.Require(CallerEndpointNative.WriteFile(pipe, bytes, (uint)bytes.Length, out written, IntPtr.Zero) && written == bytes.Length);
                Save(control, "{\"payload\":true,\"rejected\":false,\"rightsReduced\":" + rights.ToString().ToLowerInvariant() +
                    ",\"canaryExcluded\":" + canaryExcluded.ToString().ToLowerInvariant() + ",\"pid\":" + Process.GetCurrentProcess().Id + "}");
                Thread.Sleep(Timeout.Infinite); return 0;
                }
            }
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(control, "refusal.txt"), "step=" + step + "\nelapsed=" + timer.ElapsedMilliseconds + "\n" + error.ToString());
            Save(control, "{\"payload\":false,\"rejected\":true,\"canaryExcluded\":" + canaryExcluded.ToString().ToLowerInvariant() + ",\"pid\":" + Process.GetCurrentProcess().Id + "}");
            Thread.Sleep(Timeout.Infinite); return 0;
        }
    }
}
