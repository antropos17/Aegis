using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Formatters.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class EnrollmentLeaseFixture
{
    [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint Low; internal int High; }
    [StructLayout(LayoutKind.Sequential)] private struct Change { internal uint Count; internal Luid Luid; internal uint Attributes; }
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(SafeFileHandle process, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool LookupPrivilegeValue(string system, string name, out Luid luid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool AdjustTokenPrivileges(SafeFileHandle token, bool disable, ref Change change, uint length, IntPtr previous, IntPtr returned);

    // All opens/identity/read/security rechecks/closure use native objects.
    // Protected-descriptor acceptance and changed projections are explicit models.
    private sealed class Files : IEnrollmentFiles
    {
        internal readonly string Root, Mode;
        internal readonly List<Wrapped> Opened = new List<Wrapped>();
        internal bool Changed, Block;
        internal readonly ManualResetEvent Entered = new ManualResetEvent(false), Release = new ManualResetEvent(false);
        internal Files(string root, string mode) { Root = root; Mode = mode; }
        public EnrollmentHeld Open(string path, bool directory)
        {
            if (Mode == "partial-open" && Path.GetFileName(path) == "enrollment.json") throw new IOException();
            var value = new Wrapped(this, new EnrollmentNative().Open(path, directory)); Opened.Add(value); return value;
        }
    }
    private sealed class Wrapped : EnrollmentHeld
    {
        private readonly Files files;
        private readonly EnrollmentHeld native;
        internal bool Closed;
        internal Wrapped(Files owner, EnrollmentHeld held) { files = owner; native = held; }
        private bool Target
        {
            get {
                return files.Changed && (files.Mode.StartsWith("ancestor-", StringComparison.Ordinal)
                    ? native.PathName == Path.GetDirectoryName(files.Root)
                    : files.Mode.StartsWith("record-", StringComparison.Ordinal) ? Path.GetFileName(native.PathName) == "enrollment.json"
                    : files.Mode.StartsWith("image-", StringComparison.Ordinal) ? Path.GetFileName(native.PathName) == "aegis-session.exe"
                    : native.PathName == files.Root);
            }
        }
        internal override string PathName { get { return Target && files.Mode.EndsWith("path") ? native.PathName + "-other" : native.PathName; } }
        internal override string Volume { get { return Target && files.Mode.EndsWith("volume") ? new string('f', 16) : native.Volume; } }
        internal override string FileId { get { return Target && files.Mode.EndsWith("identity") ? new string('f', 32) : native.FileId; } }
        internal override bool Directory { get { return Target && files.Mode.EndsWith("kind") ? !native.Directory : native.Directory; } }
        internal override bool Reparse { get { return (Target && files.Mode.EndsWith("reparse")) || native.Reparse; } }
        internal override bool Protected(bool ancestor) { return !(Target && files.Mode.EndsWith("security")); }
        internal override byte[] Read(int maximum)
        {
            byte[] bytes = native.Read(maximum);
            if (Target && files.Mode == "image-bytes") bytes[bytes.Length - 1] ^= 1;
            if (files.Changed && Path.GetFileName(native.PathName) == "enrollment.json") {
                string text = Encoding.UTF8.GetString(bytes);
                if (files.Mode == "record-epoch") text = text.Replace(new string('b', 32), new string('d', 32));
                if (files.Mode == "record-revision") text = text.Replace("\"revision\":1", "\"revision\":2");
                if (files.Mode == "record-status") text = text.Replace("active", "revoked");
                bytes = Encoding.UTF8.GetBytes(text);
            }
            return bytes;
        }
        internal override void Recheck(bool ancestor)
        {
            if (files.Changed && files.Mode == "query-failure") throw new IOException("untrusted-diagnostic");
            if (files.Block && native.PathName == files.Root) {
                files.Entered.Set(); Require(files.Release.WaitOne(4000));
            }
            native.Recheck(ancestor);
        }
        public override void Dispose()
        { native.Dispose(); Closed = true; if (files.Mode == "close-failure") throw new IOException("untrusted-diagnostic"); }
    }
    private static void Require(bool value) { if (!value) throw new InvalidDataException("fixture-control-failed"); }
    private static string Hash(string path)
    {
        using (SHA256 sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", "").ToLowerInvariant();
    }
    private static void Prepare(string root, string image)
    {
        using (EnrollmentHeld held = new EnrollmentNative().Open(root, true))
            File.WriteAllText(Path.Combine(root, "enrollment.json"),
                "{\"schemaVersion\":1,\"installId\":\"" + new string('a', 32) + "\",\"revision\":1," +
                "\"epoch\":\"" + new string('b', 32) + "\",\"rootVolumeSerial\":\"" + held.Volume +
                "\",\"rootFileId\":\"" + held.FileId + "\",\"supervisorSha256\":\"" + Hash(image) +
                "\",\"status\":\"active\"}", new UTF8Encoding(false));
    }
    private static bool Refused(Action action)
    {
        try { action(); return false; }
        catch (InvalidDataException error) { Require(error.Message == "enrollment-lease-unavailable"); return true; }
    }
    private static bool Writable(string path)
    {
        try { using (var writer = File.Open(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) { } return true; }
        catch (IOException) { return false; }
    }
    private static void MutateToken(SafeFileHandle process, bool restore)
    {
        SafeFileHandle token;
        Require(OpenProcessToken(process, 0x28, out token));
        using (token) {
            Luid luid; Require(LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out luid));
            byte[] before = TokenBytes(token, 10); uint attributes = Privilege(token, luid);
            Require((attributes & 2) != 0);
            var change = new Change { Count = 1, Luid = luid, Attributes = 0 };
            Require(AdjustTokenPrivileges(token, false, ref change, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0);
            byte[] after = TokenBytes(token, 10);
            Require((Privilege(token, luid) & 2) == 0 && BitConverter.ToUInt64(before, 0) == BitConverter.ToUInt64(after, 0) &&
                BitConverter.ToUInt64(before, 8) == BitConverter.ToUInt64(after, 8) && BitConverter.ToUInt64(before, 48) != BitConverter.ToUInt64(after, 48));
            if (restore) { change.Attributes = 2;
                Require(AdjustTokenPrivileges(token, false, ref change, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0);
                byte[] restored = TokenBytes(token, 10);
                Require(Privilege(token, luid) == attributes && BitConverter.ToUInt64(restored, 0) == BitConverter.ToUInt64(before, 0) &&
                    BitConverter.ToUInt64(restored, 48) != BitConverter.ToUInt64(before, 48)); }
        }
    }
    private static byte[] TokenBytes(SafeFileHandle token, int kind)
    {
        int size; Require(!CallerNative.GetTokenInformation(token, kind, IntPtr.Zero, 0, out size) && size >= 4 && size <= 65536);
        IntPtr memory = Marshal.AllocHGlobal(size);
        try { int returned; Require(CallerNative.GetTokenInformation(token, kind, memory, size, out returned) && returned <= size && returned >= 4);
            byte[] bytes = new byte[returned]; Marshal.Copy(memory, bytes, 0, returned);
            if (kind == 10) Require(returned >= 56); return bytes; }
        finally { Marshal.FreeHGlobal(memory); }
    }
    private static uint Privilege(SafeFileHandle token, Luid selected)
    {
        byte[] bytes = TokenBytes(token, 3); uint count = BitConverter.ToUInt32(bytes, 0);
        Require(count <= 256 && 4L + 12L * count <= bytes.Length);
        for (int index = 0; index < count; index++) {
            int at = 4 + 12 * index;
            if (BitConverter.ToUInt32(bytes, at) == selected.Low && BitConverter.ToInt32(bytes, at + 4) == selected.High)
                return BitConverter.ToUInt32(bytes, at + 8);
        }
        throw new InvalidDataException("fixture-privilege-unavailable");
    }
    private static void Concurrent(EnrollmentLease lease, Files files)
    {
        files.Block = true; Exception readerError = null, revokeError = null;
        var finished = new ManualResetEvent(false);
        var reader = new Thread(() => { try { lease.CheckCurrent(); } catch (Exception error) { readerError = error; } });
        var revoker = new Thread(() => { try { lease.Revoke(); } catch (Exception error) { revokeError = error; } finally { finished.Set(); } });
        reader.IsBackground = true; revoker.IsBackground = true;
        try {
            reader.Start(); Require(files.Entered.WaitOne(1000)); revoker.Start();
            Require(!finished.WaitOne(100)); files.Release.Set();
            Require(reader.Join(4000) && revoker.Join(4000) && readerError == null && revokeError == null);
            Require(Refused(lease.CheckCurrent));
        }
        finally { files.Release.Set(); files.Block = false; finished.Dispose(); }
    }
    private static int Main(string[] args)
    {
        try { Run(args); return 0; }
        catch { Console.Error.WriteLine("enrollment-lease-fixture-refused"); return 1; }
    }
    private static void Run(string[] args)
    {
        string mode = args[0], root = args[1], image = Path.Combine(root, "aegis-session.exe");
        Prepare(root, image); var files = new Files(root, mode);
        var native = new CallerLauncherNative();
        CallerLauncherNative.Created child = native.Create(mode == "wrong-image" ? Path.Combine(Path.GetDirectoryName(root), "fixed-child.exe") : image);
        CallerLauncherNative.Created foreign = null; EnrollmentLease lease = null;
        bool originalsClosed = false, recordWriteRefused = false, invalidated = false, stopped = false, cleanupUnknown = false;
        using (SafeFileHandle witness = LauncherObservation.Hold(child.Pid))
        try
        {
            LauncherObservation.JobAndHandles(child.Process, child.Thread, child.Job);
            Require(LauncherObservation.Image(witness) == (mode == "wrong-image" ? Path.Combine(Path.GetDirectoryName(root), "fixed-child.exe") : image));
            Require(CallerLauncherNative.ResumeThread(child.Thread) == 1);
            IntPtr selectedJob = child.Job.DangerousGetHandle();
            if (mode == "wrong-job") { foreign = native.Create(image); selectedJob = foreign.Job.DangerousGetHandle(); }
            if (mode == "strict-root" || mode == "wrong-image" || mode == "wrong-job" || mode == "partial-open") {
                invalidated = Refused(() => { lease = mode == "strict-root"
                    ? EnrollmentLease.Acquire(root, child.Process.DangerousGetHandle(), selectedJob)
                    : EnrollmentLease.AcquireForTest(root, child.Process.DangerousGetHandle(), selectedJob, files); });
                Require(invalidated && lease == null && files.Opened.TrueForAll(value => value.Closed));
            }
            else {
                lease = EnrollmentLease.AcquireForTest(root, child.Process.DangerousGetHandle(), selectedJob, files);
                lease.CheckCurrent(); lease.CheckCurrent();
                recordWriteRefused = !Writable(Path.Combine(root, "enrollment.json")); Require(recordWriteRefused);
                bool deleteRefused = false, renameRefused = false;
                try { File.Delete(Path.Combine(root, "enrollment.json")); } catch (IOException) { deleteRefused = true; }
                try { Directory.Move(root, root + "-renamed"); } catch (IOException) { renameRefused = true; }
                Require(deleteRefused && renameRefused);
                if (mode == "original-handles-closed") {
                    child.Dispose(); originalsClosed = true;
                    Require(LauncherObservation.WaitForSingleObject(witness, 0) == 0x102); lease.CheckCurrent();
                }
                else if (mode == "owner-exit") { CallerLauncherNative.Stop(child); stopped = true; invalidated = Refused(lease.CheckCurrent); }
                else if (mode == "token-change" || mode == "token-change-restore") {
                    using (var self = Process.GetCurrentProcess())
                    using (var selfHandle = CallerNative.Duplicate(self.Handle))
                    using (var selfToken = CallerNative.ProcessToken(selfHandle)) {
                        CallerIdentity before = CallerIdentity.Observe(selfToken);
                        MutateToken(child.Process, mode == "token-change-restore");
                        Require(before.SamePrimaryToken(CallerIdentity.Observe(selfToken)));
                    }
                    invalidated = Refused(lease.CheckCurrent);
                }
                else if (mode == "revoke") { lease.Revoke(); invalidated = Refused(lease.CheckCurrent); }
                else if (mode == "thread-impersonation") {
                    using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
                    using (var context = identity.Impersonate()) {
                        Require(CallerNative.HasThreadToken()); invalidated = Refused(lease.CheckCurrent);
                    }
                    Require(!CallerNative.HasThreadToken() && Refused(lease.CheckCurrent));
                }
                else if (mode == "concurrent-revoke") { Concurrent(lease, files); invalidated = true; }
                else if (mode == "serialization") {
                    bool refused = false;
                    try { using (var memory = new MemoryStream()) new BinaryFormatter().Serialize(memory, lease); }
                    catch (SerializationException) { refused = true; }
                    Require(refused); lease.CheckCurrent();
                }
                else if (mode == "close-failure") { cleanupUnknown = Refused(lease.Dispose); Require(cleanupUnknown && Refused(lease.Dispose)); invalidated = Refused(lease.CheckCurrent); }
                else if (mode != "retained-pins" && mode != "dispose") {
                    files.Changed = true; invalidated = Refused(lease.CheckCurrent);
                    files.Changed = false; Require(Refused(lease.CheckCurrent));
                }
                if (mode == "dispose") { lease.Dispose(); lease.Dispose(); invalidated = Refused(lease.CheckCurrent); }
                Require(mode == "retained-pins" || mode == "original-handles-closed" || mode == "serialization" || invalidated);
                if (mode != "close-failure") { lease.Dispose(); lease.Dispose(); }
                Require(files.Opened.TrueForAll(value => value.Closed));
            }
            Require(Writable(Path.Combine(root, "enrollment.json")));
            if (originalsClosed) Require(LauncherObservation.WaitForSingleObject(witness, 4000) == 0);
            Console.WriteLine("{\"nativeFiles\":true,\"nativeProcessAndJobControls\":true,\"protectedDescriptorsModeled\":" +
                (mode != "strict-root").ToString().ToLowerInvariant() + "," +
                "\"recordWriteRefused\":" + recordWriteRefused.ToString().ToLowerInvariant() +
                ",\"invalidated\":" + invalidated.ToString().ToLowerInvariant() +
                ",\"originalsClosed\":" + originalsClosed.ToString().ToLowerInvariant() +
                ",\"cleanupUnknown\":" + cleanupUnknown.ToString().ToLowerInvariant() +
                ",\"recordPinsReleased\":true,\"launchAllowed\":false}");
        }
        finally {
            files.Release.Set(); files.Entered.Dispose(); files.Release.Dispose();
            if (lease != null) try { lease.Dispose(); } catch (InvalidDataException) { Require(mode == "close-failure"); }
            if (!originalsClosed) { try { if (!stopped) CallerLauncherNative.Stop(child); } finally { child.Dispose(); } }
            if (foreign != null) { try { CallerLauncherNative.Stop(foreign); } finally { foreign.Dispose(); } }
        }
    }
}
