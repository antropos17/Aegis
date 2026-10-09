using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// Disposable same-principal experiment. Protected descriptor acceptance is modeled.
internal static class EnrollmentAncestorFixture
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share,
        IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind,
        byte[] data, uint size);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint GetSecurityInfo(SafeFileHandle file, int type, uint information,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    private sealed class Files : IEnrollmentFiles
    {
        private readonly string parent, mode, sibling;
        internal bool CaptureMutated;
        internal Files(string target, string selected, string mutation)
        { parent = target; mode = selected; sibling = mutation; }
        public EnrollmentHeld Open(string path, bool directory)
        { return new Wrapped(this, new EnrollmentNative().Open(path, directory)); }
        internal void BeforeRecheck(string path)
        {
            // Exact one-variable mutation after native capture, before its final check.
            if (mode == "capture-sibling" && path == parent && !CaptureMutated)
            { Directory.CreateDirectory(sibling); CaptureMutated = true; }
        }
    }
    private sealed class Wrapped : EnrollmentHeld
    {
        private readonly EnrollmentHeld native;
        private readonly Files files;
        internal Wrapped(Files owner, EnrollmentHeld value) { files = owner; native = value; }
        internal override string PathName { get { return native.PathName; } }
        internal override string Volume { get { return native.Volume; } }
        internal override string FileId { get { return native.FileId; } }
        internal override bool Directory { get { return native.Directory; } }
        internal override bool Reparse { get { return native.Reparse; } }
        internal override bool Protected(bool ancestor) { return true; }
        internal override byte[] Read(int maximum) { return native.Read(maximum); }
        internal override void Recheck(bool ancestor) { files.BeforeRecheck(native.PathName); native.Recheck(ancestor); }
        public override void Dispose() { native.Dispose(); }
    }
    private sealed class Observation
    {
        internal byte[] Identity, Basic, Attributes, Security;
        internal string Json()
        {
            return "{\"fileIdInfoHex\":\"" + Hex(Identity) + "\",\"securitySha256\":\"" + Hash(Security) +
                "\",\"fileBasicInfoHex\":\"" + Hex(Basic) + "\",\"creationTime\":\"" + BitConverter.ToInt64(Basic, 0) +
                "\",\"lastAccessTime\":\"" + BitConverter.ToInt64(Basic, 8) + "\",\"lastWriteTime\":\"" + BitConverter.ToInt64(Basic, 16) +
                "\",\"changeTime\":\"" + BitConverter.ToInt64(Basic, 24) + "\",\"attributeTagHex\":\"" + Hex(Attributes) + "\"}";
        }
    }
    private static void Require(bool value, string label)
    { if (!value) throw new InvalidDataException(label); }
    private static string Flag(bool value) { return value.ToString().ToLowerInvariant(); }
    private static string Hex(byte[] data) { return BitConverter.ToString(data).Replace("-", "").ToLowerInvariant(); }
    private static string Hash(byte[] data)
    { using (SHA256 hash = SHA256.Create()) return Hex(hash.ComputeHash(data)); }
    private static byte[] Query(SafeFileHandle file, int kind, int size)
    { byte[] data = new byte[size]; Require(GetFileInformationByHandleEx(file, kind, data, (uint)size), "independent-file-query"); return data; }
    private static Observation Observe(SafeFileHandle file)
    {
        IntPtr owner, group, dacl, sacl, descriptor;
        Require(GetSecurityInfo(file, 1, 5, out owner, out group, out dacl, out sacl, out descriptor) == 0, "independent-security-query");
        byte[] security;
        try {
            uint length = GetSecurityDescriptorLength(descriptor); Require(length > 0 && length <= 65536, "security-size");
            security = new byte[length]; Marshal.Copy(descriptor, security, 0, security.Length);
        }
        finally { LocalFree(descriptor); }
        return new Observation { Identity = Query(file, 18, 24), Basic = Query(file, 0, 40), Attributes = Query(file, 9, 8), Security = security };
    }
    private static bool Stable(Observation first, Observation second)
    {
        if (Hex(first.Identity) != Hex(second.Identity) || Hex(first.Security) != Hex(second.Security) ||
            Hex(first.Attributes) != Hex(second.Attributes)) return false;
        for (int index = 0; index < first.Basic.Length; index++)
            if ((index < 8 || index >= 32) && first.Basic[index] != second.Basic[index]) return false;
        return true;
    }
    private static bool Refused(Action action)
    { try { action(); return false; } catch (InvalidDataException) { return true; } }
    private static void Prepare(string root, string image)
    {
        using (EnrollmentHeld held = new EnrollmentNative().Open(root, true))
            File.WriteAllText(Path.Combine(root, "enrollment.json"),
                "{\"schemaVersion\":1,\"installId\":\"" + new string('a', 32) + "\",\"revision\":1," +
                "\"epoch\":\"" + new string('b', 32) + "\",\"rootVolumeSerial\":\"" + held.Volume +
                "\",\"rootFileId\":\"" + held.FileId + "\",\"supervisorSha256\":\"" + Hash(File.ReadAllBytes(image)) +
                "\",\"status\":\"active\"}", new UTF8Encoding(false));
    }
    private static int Main(string[] args)
    {
        string phase = "arguments";
        try {
            Require(args.Length == 2, "fixture-arguments");
            string mode = args[0], parent = Path.GetFullPath(args[1]), root = Path.Combine(parent, "owned"), sibling = Path.Combine(parent, "sibling");
            Require(!Directory.Exists(parent), "new-parent-only");
            Directory.CreateDirectory(root);
            string image = Path.Combine(root, "aegis-session.exe");
            File.Copy(Path.Combine(Path.GetDirectoryName(typeof(EnrollmentAncestorFixture).Assembly.Location), "fixed-child.exe"), image);
            Prepare(root, image);
            bool leaf = mode.StartsWith("leaf-", StringComparison.Ordinal), rootTarget = mode.StartsWith("root-", StringComparison.Ordinal);
            string target = leaf ? Path.Combine(root, "enrollment.json") : rootTarget ? root : parent;
            if (mode == "root-child") sibling = Path.Combine(root, "unadmitted-child");
            var files = new Files(parent, mode, sibling);
            var child = new CallerLauncherNative().Create(image);
            EnrollmentLease lease = null;
            try {
                Require(CallerLauncherNative.ResumeThread(child.Thread) == 1, "resume-child");
                using (var held = new EnrollmentNative().Open(target, !leaf))
                using (var witness = CreateFile(target, 0x20080, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero))
                {
                    Require(!witness.IsInvalid, "independent-target-hold");
                    held.Recheck(!leaf && !rootTarget);
                    Observation before = Observe(witness);
                    phase = "acquisition";
                    bool acquisitionRefused = false;
                    try { lease = EnrollmentLease.AcquireForTest(root, child.Process.DangerousGetHandle(), child.Job.DangerousGetHandle(), files); }
                    catch (InvalidDataException) { if (mode != "capture-sibling") throw; acquisitionRefused = true; }
                    phase = "clean-control";
                    if (mode != "capture-sibling") { held.Recheck(!leaf && !rootTarget); lease.CheckCurrent(); before = Observe(witness); }
                    bool mutationApplied = mode == "capture-sibling" && files.CaptureMutated, mutationBlocked = false;
                    try {
                        if (mode == "sibling" || mode == "root-child") { Directory.CreateDirectory(sibling); mutationApplied = true; }
                        else if (mode == "ancestor-creation") { File.SetCreationTimeUtc(target, File.GetCreationTimeUtc(target).AddSeconds(5)); mutationApplied = true; }
                        else if (mode.EndsWith("-attributes", StringComparison.Ordinal)) { File.SetAttributes(target, File.GetAttributes(target) ^ FileAttributes.Hidden); mutationApplied = true; }
                        else if (mode.EndsWith("-time", StringComparison.Ordinal)) { File.SetLastWriteTimeUtc(target, File.GetLastWriteTimeUtc(target).AddSeconds(5)); mutationApplied = true; }
                        else Require(mode == "clean" || mode == "capture-sibling" || mode == "leaf-role", "mode-unavailable");
                    }
                    catch (IOException) { mutationBlocked = true; }
                    catch (UnauthorizedAccessException) { mutationBlocked = true; }
                    Observation after = Observe(witness);
                    phase = "post-change-check";
                    bool snapshotRefused = Refused(() => held.Recheck(mode == "leaf-role" || (!leaf && !rootTarget))), leaseRefused = acquisitionRefused || Refused(lease.CheckCurrent);
                    bool timestampChanged = BitConverter.ToInt64(before.Basic, 16) != BitConverter.ToInt64(after.Basic, 16) ||
                        BitConverter.ToInt64(before.Basic, 24) != BitConverter.ToInt64(after.Basic, 24);
                    bool unchangedBindings = Stable(before, after);
                    Observation afterDelete = null; bool stickyRefused = false, leasePassedAfterDelete = false;
                    if (mode == "sibling" || mode == "root-child" || mode == "capture-sibling") {
                        Directory.Delete(sibling); afterDelete = Observe(witness); stickyRefused = acquisitionRefused || Refused(lease.CheckCurrent);
                        leasePassedAfterDelete = !stickyRefused;
                    }
                    if (mode == "clean" || mode == "sibling" || mode == "root-child" || mode == "capture-sibling")
                        Require(unchangedBindings, "identity-security-attributes-changed");
                    Require(mode != "clean" || (!snapshotRefused && !leaseRefused), "clean-control-refused");
                    Console.WriteLine("{\"mode\":\"" + mode + "\",\"protectedDescriptorsModeled\":true,\"cleanControlPassed\":true," +
                        "\"acquisitionRefused\":" + Flag(acquisitionRefused) + ",\"mutationApplied\":" + Flag(mutationApplied) + ",\"mutationBlocked\":" + Flag(mutationBlocked) +
                        ",\"bindingsUnchanged\":" + Flag(unchangedBindings) + ",\"writeOrChangeTimestampChanged\":" + Flag(timestampChanged) +
                        ",\"retainedSnapshotRefused\":" + Flag(snapshotRefused) + ",\"leaseRefused\":" + Flag(leaseRefused) +
                        ",\"stickyAfterDelete\":" + Flag(stickyRefused) + ",\"leasePassedAfterDelete\":" + Flag(leasePassedAfterDelete) + ",\"before\":" + before.Json() + ",\"after\":" + after.Json() +
                        ",\"afterDelete\":" + (afterDelete == null ? "null" : afterDelete.Json()) + ",\"launchAllowed\":false}");
                }
            }
            finally { if (lease != null) lease.Dispose(); try { CallerLauncherNative.Stop(child); } finally { child.Dispose(); } }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine("phase=" + phase + ";" + error.GetType().Name + ":" + error.Message); return 1; }
    }
}
