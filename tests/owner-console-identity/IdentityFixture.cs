using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;

internal static class IdentityFixture
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Entry { public uint size, usage, pid; public UIntPtr heap; public uint module, threads, parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string exe; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool Process32First(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool Process32Next(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);

    private static void Require(bool result, string message) { if (!result) throw new Exception(message); }
    private static void Reject(Action action, string name) { try { action(); } catch { return; } throw new Exception("accepted " + name); }
    private static uint Parent(uint pid)
    {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        Require(snapshot != new IntPtr(-1), "snapshot");
        try {
            Entry entry = new Entry(); entry.size = (uint)Marshal.SizeOf(typeof(Entry));
            if (Process32First(snapshot, ref entry)) do { if (entry.pid == pid) return entry.parent; } while (Process32Next(snapshot, ref entry));
            throw new Exception("parent not found");
        } finally { CloseHandle(snapshot); }
    }

    private static int Main(string[] args)
    {
        try {
            if (args.Length > 0 && args[0] == "middle") Middle(args[1]);
            else if (args.Length > 0 && args[0] == "verifier") Verifier(args[1]);
            else if (args.Length > 0) Child(args);
            else { ParentFixture(); TopologyFixture(); }
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine("FAIL " + ex.Message); return 1; }
    }

    private static void Child(string[] args)
    {
        uint outer = UInt32.Parse(args[2]);
        string outerPath = Process.GetProcessById((int)outer).MainModule.FileName;
        using (PeerIdentity.PinnedImage self = PeerIdentity.PinnedImage.Open(Process.GetCurrentProcess().MainModule.FileName))
        using (PeerIdentity.PinnedImage outerImage = PeerIdentity.PinnedImage.Open(outerPath))
        using (PeerIdentity.ProcessIdentity parentOfServer = PeerIdentity.ProcessIdentity.Capture(outer, outerImage))
        using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", args[1], PipeDirection.InOut))
        {
            pipe.Connect(5000);
            using (PeerIdentity.ProcessIdentity server = PeerIdentity.VerifyPipePeer(pipe.SafePipeHandle.DangerousGetHandle(), true, parentOfServer, self, IntPtr.Zero))
                Require(server.Id == UInt32.Parse(args[0]), "actual server PID");
            Reject(delegate { using (PeerIdentity.ServerLineage wrong = PeerIdentity.VerifyAncestorServer(pipe.SafePipeHandle.DangerousGetHandle(), self, self)) {} }, "server as direct parent, not grandparent");
            pipe.WriteByte(1); pipe.Flush();
            Require(pipe.ReadByte() == 2, "server acknowledgment");
        }
    }

    private static void ParentFixture()
    {
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        uint selfPid = (uint)Process.GetCurrentProcess().Id;
        uint outer = Parent(selfPid);
        string name = "aegis-identity-fixture-" + Guid.NewGuid().ToString("N");
        IntPtr job = CreateJobObject(IntPtr.Zero, null), otherJob = CreateJobObject(IntPtr.Zero, null);
        Require(job != IntPtr.Zero && otherJob != IntPtr.Zero, "jobs");
        Process child = null;
        try {
            string pinFixture = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "identity-pin-fixture.txt");
            File.WriteAllText(pinFixture, "identity fixture");
            using (PeerIdentity.PinnedImage filePin = PeerIdentity.PinnedImage.Open(pinFixture))
            {
                Reject(delegate { using (FileStream f = new FileStream(pinFixture, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) {} }, "write to pinned file");
                Reject(delegate { File.Delete(pinFixture); }, "delete pinned file");
            }
            using (PeerIdentity.PinnedImage image = PeerIdentity.PinnedImage.Open(executable))
            using (PeerIdentity.PinnedImage wrongImage = PeerIdentity.PinnedImage.Open(Process.GetProcessById((int)outer).MainModule.FileName))
            using (PeerIdentity.ProcessIdentity parent = PeerIdentity.ProcessIdentity.Capture(selfPid, image))
            using (NamedPipeServerStream pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous))
            {
                ProcessStartInfo start = new ProcessStartInfo(executable, selfPid + " " + name + " " + outer);
                start.UseShellExecute = false; start.CreateNoWindow = true;
                child = Process.Start(start);
                Require(AssignProcessToJobObject(job, child.Handle), "assign job");
                IAsyncResult connection = pipe.BeginWaitForConnection(null, null);
                Require(connection.AsyncWaitHandle.WaitOne(5000), "connect deadline");
                pipe.EndWaitForConnection(connection);
                IntPtr handle = pipe.SafePipeHandle.DangerousGetHandle();
                using (PeerIdentity.ProcessIdentity observed = PeerIdentity.VerifyPipePeer(handle, false, parent, image, job))
                using (PeerIdentity.ProcessIdentity launched = PeerIdentity.ProcessIdentity.CaptureLaunched(child.Handle, image))
                {
                    Require(observed.Id == (uint)child.Id && launched.Id == observed.Id && launched.IsLive(), "actual child identity");
                    Reject(delegate { using (PeerIdentity.ProcessIdentity p = PeerIdentity.VerifyPipePeer(handle, false, parent, wrongImage, job)) {} }, "wrong image");
                    Reject(delegate { using (PeerIdentity.ProcessIdentity p = PeerIdentity.VerifyPipePeer(handle, false, parent, image, otherJob)) {} }, "wrong job");
                    Reject(delegate { using (PeerIdentity.ProcessIdentity p = PeerIdentity.VerifyPipePeer(handle, false, launched, image, job)) {} }, "wrong parent");
                    Require(pipe.ReadByte() == 1, "client validation"); pipe.WriteByte(2); pipe.Flush();
                    Require(child.WaitForExit(5000) && child.ExitCode == 0, "child completion");
                    Require(!launched.IsLive() && !observed.IsLive(), "exit invalidates held identity");
                    Reject(delegate { using (PeerIdentity.ProcessIdentity p = PeerIdentity.VerifyPipePeer(handle, false, parent, image, job)) {} }, "exited peer");
                }
            }
            Console.WriteLine("PASS mutual actual pipe PIDs, retained handles, image pin, parent, creation order, Job membership and exited peer");
        } finally {
            if (child != null) { if (!child.HasExited) child.Kill(); child.Dispose(); }
            CloseHandle(job); CloseHandle(otherJob);
        }
    }

    private static void Middle(string name)
    {
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        ProcessStartInfo start = new ProcessStartInfo(exe, "verifier " + name); start.UseShellExecute = false; start.CreateNoWindow = true;
        using (Process verifier = Process.Start(start)) {
            if (!verifier.WaitForExit(5000)) { verifier.Kill(); throw new Exception("verifier timeout"); }
            Require(verifier.ExitCode == 0, "verifier exit");
        }
    }

    private static void Verifier(string name)
    {
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        using (PeerIdentity.PinnedImage nativeImage = PeerIdentity.PinnedImage.Open(exe))
        using (PeerIdentity.PinnedImage wrongImage = PeerIdentity.PinnedImage.Open(Path.Combine(Environment.SystemDirectory, "notepad.exe")))
        using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut))
        {
            pipe.Connect(5000); IntPtr handle = pipe.SafePipeHandle.DangerousGetHandle();
            using (PeerIdentity.ServerLineage lineage = PeerIdentity.VerifyAncestorServer(handle, nativeImage, nativeImage))
            {
                Require(lineage.IsLive() && lineage.Electron.Id == Parent((uint)Process.GetCurrentProcess().Id), "middle identity");
                Reject(delegate { using (PeerIdentity.ServerLineage wrong = PeerIdentity.VerifyAncestorServer(handle, wrongImage, nativeImage)) {} }, "wrong electron image");
                Reject(delegate { using (PeerIdentity.ServerLineage wrong = PeerIdentity.VerifyAncestorServer(handle, nativeImage, wrongImage)) {} }, "wrong native image");
                pipe.WriteByte(3); pipe.Flush(); Require(pipe.ReadByte() == 4, "topology acknowledgment");
            }
        }
    }

    private static void TopologyFixture()
    {
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        string name = "aegis-lineage-fixture-" + Guid.NewGuid().ToString("N");
        using (PeerIdentity.PinnedImage image = PeerIdentity.PinnedImage.Open(exe))
        using (NamedPipeServerStream pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous))
        {
            ProcessStartInfo start = new ProcessStartInfo(exe, "middle " + name); start.UseShellExecute = false; start.CreateNoWindow = true;
            using (Process middle = Process.Start(start))
            try {
                using (PeerIdentity.ProcessIdentity launched = PeerIdentity.ProcessIdentity.CaptureLaunched(middle.Handle, image))
                {
                    IAsyncResult connected = pipe.BeginWaitForConnection(null, null);
                    Require(connected.AsyncWaitHandle.WaitOne(5000), "topology connect deadline"); pipe.EndWaitForConnection(connected);
                    using (PeerIdentity.ProcessIdentity verifier = PeerIdentity.VerifyPipePeer(pipe.SafePipeHandle.DangerousGetHandle(), false, launched, image, IntPtr.Zero))
                    {
                        Require(verifier.IsLive(), "verifier live");
                        Require(pipe.ReadByte() == 3, "lineage verification"); pipe.WriteByte(4); pipe.Flush();
                        Require(middle.WaitForExit(5000) && middle.ExitCode == 0, "middle completion");
                    }
                }
            } finally { if (!middle.HasExited) middle.Kill(); }
        }
        Console.WriteLine("PASS actual server -> middle -> verifier lineage and image rejection");
    }
}
