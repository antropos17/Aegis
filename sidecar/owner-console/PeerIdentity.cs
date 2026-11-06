using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

// A peer PID is obtained from the connected pipe, not from protocol input.
// Parent relationships are Windows process metadata, not proof against a
// same-user process able to inject, duplicate handles or spoof parent creation.
internal static class PeerIdentity
{
    private const uint QueryAndSynchronize = 0x00101000;
    private const uint WaitTimeout = 258;
    private const uint DuplicateSameAccess = 2;
    private const int ProcessBasicInformation = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfoNative
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasic
    {
        public IntPtr ExitStatus, Peb, Affinity, BasePriority;
        public UIntPtr ProcessId, ParentProcessId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint id);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint id);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(SafeProcessHandle process, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(SafeProcessHandle process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(SafeProcessHandle process, uint code);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(SafeProcessHandle process, uint flags, StringBuilder name, ref int length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(SafeProcessHandle process, IntPtr job, out bool result);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out SafeProcessHandle target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfoNative info);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint capacity, uint flags);
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(SafeProcessHandle process, int informationClass, out ProcessBasic information, int length, out int returnedLength);

    internal sealed class PinnedImage : IDisposable
    {
        private readonly FileStream stream;
        private readonly FileInfoNative identity;
        private readonly string finalPath;
        private bool disposed;

        private PinnedImage(FileStream stream)
        {
            this.stream = stream;
            identity = FileInformation(stream.SafeFileHandle);
            finalPath = FinalPath(stream.SafeFileHandle);
        }

        internal static PinnedImage Open(string path)
        {
            if (String.IsNullOrEmpty(path) || !Path.IsPathRooted(path)) throw Failure();
            FileStream file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            try { return new PinnedImage(file); }
            catch { file.Dispose(); throw; }
        }

        internal bool Matches(string path)
        {
            if (disposed || String.IsNullOrEmpty(path)) return false;
            using (FileStream observed = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                FileInfoNative actual = FileInformation(observed.SafeFileHandle);
                return identity.VolumeSerial == actual.VolumeSerial && identity.IndexHigh == actual.IndexHigh &&
                    identity.IndexLow == actual.IndexLow && String.Equals(finalPath, FinalPath(observed.SafeFileHandle), StringComparison.OrdinalIgnoreCase);
            }
        }

        public void Dispose() { if (!disposed) { disposed = true; stream.Dispose(); } }
    }

    internal sealed class ProcessIdentity : IDisposable
    {
        internal readonly SafeProcessHandle handle;
        internal readonly long created;
        private bool disposed;
        internal uint Id { get; private set; }

        private ProcessIdentity(SafeProcessHandle process, PinnedImage expected)
        {
            handle = process;
            Id = GetProcessId(handle);
            long exited, kernel, user;
            if (Id == 0 || WaitForSingleObject(handle, 0) != WaitTimeout ||
                !GetProcessTimes(handle, out created, out exited, out kernel, out user) || created <= 0) throw Failure();
            StringBuilder name = new StringBuilder(32768);
            int size = name.Capacity;
            if (!QueryFullProcessImageName(handle, 0, name, ref size) || !expected.Matches(name.ToString()) || !IsLive()) throw Failure();
        }

        internal static ProcessIdentity Capture(uint id, PinnedImage expected)
        {
            if (id == 0 || expected == null) throw Failure();
            SafeProcessHandle process = OpenProcess(QueryAndSynchronize, false, id);
            if (process.IsInvalid) { process.Dispose(); throw Failure(); }
            try { return new ProcessIdentity(process, expected); }
            catch { process.Dispose(); throw; }
        }

        internal static ProcessIdentity CaptureLaunched(IntPtr launchedProcess, PinnedImage expected)
        {
            if (launchedProcess == IntPtr.Zero || expected == null) throw Failure();
            SafeProcessHandle process;
            if (!DuplicateHandle(GetCurrentProcess(), launchedProcess, GetCurrentProcess(), out process, 0, false, DuplicateSameAccess)) throw Failure();
            try { return new ProcessIdentity(process, expected); }
            catch { process.Dispose(); throw; }
        }

        internal bool IsLive()
        {
            if (disposed || WaitForSingleObject(handle, 0) != WaitTimeout) return false;
            long actual, exited, kernel, user;
            return GetProcessId(handle) == Id && GetProcessTimes(handle, out actual, out exited, out kernel, out user) && actual == created;
        }

        internal bool Stop(int timeoutMs)
        {
            if(disposed || timeoutMs<0) return false;
            if(WaitForSingleObject(handle,0)==0) return true;
            using(SafeProcessHandle target=OpenProcess(QueryAndSynchronize | 1,false,Id)) {
                if(target.IsInvalid) return WaitForSingleObject(handle,0)==0;
                long birth,exited,kernel,user;
                if(GetProcessId(target)!=Id || !GetProcessTimes(target,out birth,out exited,out kernel,out user) || birth!=created) return false;
                TerminateProcess(target,2);
                return WaitForSingleObject(handle,(uint)timeoutMs)==0;
            }
        }

        public void Dispose() { if (!disposed) { disposed = true; handle.Dispose(); } }
    }

    internal static ProcessIdentity VerifyPipePeer(IntPtr pipe, bool peerIsServer, ProcessIdentity expectedParent,
        PinnedImage expectedImage, IntPtr expectedJob)
    {
        if (pipe == IntPtr.Zero || pipe == new IntPtr(-1) || expectedParent == null || expectedImage == null || !expectedParent.IsLive()) throw Failure();
        uint peerPid;
        if (!(peerIsServer ? GetNamedPipeServerProcessId(pipe, out peerPid) : GetNamedPipeClientProcessId(pipe, out peerPid)) || peerPid == 0) throw Failure();
        ProcessIdentity peer = ProcessIdentity.Capture(peerPid, expectedImage);
        try
        {
            ProcessBasic basic; int returned;
            if (NtQueryInformationProcess(peer.handle, ProcessBasicInformation, out basic, Marshal.SizeOf(typeof(ProcessBasic)), out returned) != 0 ||
                basic.ProcessId.ToUInt64() != peerPid || basic.ParentProcessId.ToUInt64() != expectedParent.Id || peer.created <= expectedParent.created) throw Failure();
            bool inJob;
            if (expectedJob != IntPtr.Zero && (!IsProcessInJob(peer.handle, expectedJob, out inJob) || !inJob)) throw Failure();
            uint rechecked;
            if (!(peerIsServer ? GetNamedPipeServerProcessId(pipe, out rechecked) : GetNamedPipeClientProcessId(pipe, out rechecked)) ||
                rechecked != peerPid || !peer.IsLive() || !expectedParent.IsLive()) throw Failure();
            return peer;
        }
        catch { peer.Dispose(); throw; }
    }

    internal sealed class ServerLineage : IDisposable
    {
        internal readonly ProcessIdentity Electron;
        internal readonly ProcessIdentity Server;
        internal ServerLineage(ProcessIdentity electron, ProcessIdentity server) { Electron = electron; Server = server; }
        internal bool IsLive() { return Electron.IsLive() && Server.IsLive(); }
        public void Dispose() { Electron.Dispose(); Server.Dispose(); }
    }

    // Use only the current process and the connected pipe to discover the chain.
    // Both image pins must refer to the installed files selected by the caller.
    internal static ServerLineage VerifyAncestorServer(IntPtr pipe, PinnedImage electronImage, PinnedImage nativeImage)
    {
        if (pipe == IntPtr.Zero || pipe == new IntPtr(-1) || electronImage == null || nativeImage == null) throw Failure();
        ProcessIdentity self = null, electron = null, server = null;
        try
        {
            self = ProcessIdentity.Capture(GetCurrentProcessId(), nativeImage);
            uint electronPid = ParentId(self);
            electron = ProcessIdentity.Capture(electronPid, electronImage);
            uint serverPid;
            if (!GetNamedPipeServerProcessId(pipe, out serverPid) || serverPid == 0 || ParentId(electron) != serverPid) throw Failure();
            server = ProcessIdentity.Capture(serverPid, nativeImage);
            uint rechecked;
            if (self.created <= electron.created || electron.created <= server.created ||
                !GetNamedPipeServerProcessId(pipe, out rechecked) || rechecked != server.Id ||
                !self.IsLive() || !electron.IsLive() || !server.IsLive()) throw Failure();
            ServerLineage result = new ServerLineage(electron, server);
            electron = null; server = null;
            return result;
        }
        finally
        {
            if (self != null) self.Dispose();
            if (electron != null) electron.Dispose();
            if (server != null) server.Dispose();
        }
    }

    private static uint ParentId(ProcessIdentity process)
    {
        ProcessBasic basic; int returned;
        if (!process.IsLive() || NtQueryInformationProcess(process.handle, ProcessBasicInformation, out basic,
            Marshal.SizeOf(typeof(ProcessBasic)), out returned) != 0 || basic.ProcessId.ToUInt64() != process.Id ||
            basic.ParentProcessId.ToUInt64() == 0 || basic.ParentProcessId.ToUInt64() > UInt32.MaxValue || !process.IsLive()) throw Failure();
        return (uint)basic.ParentProcessId.ToUInt64();
    }

    private static FileInfoNative FileInformation(SafeFileHandle handle)
    {
        FileInfoNative info;
        if (!GetFileInformationByHandle(handle, out info)) throw Failure();
        return info;
    }

    private static string FinalPath(SafeFileHandle handle)
    {
        StringBuilder path = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(handle, path, (uint)path.Capacity, 0);
        if (length == 0 || length >= path.Capacity) throw Failure();
        return path.ToString();
    }

    private static InvalidOperationException Failure() { return new InvalidOperationException("peer identity unavailable"); }
}
