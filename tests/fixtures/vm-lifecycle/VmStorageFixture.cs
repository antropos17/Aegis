using System;
using System.Collections.Generic;
using System.IO;
using Aegis.ProtectedSession;

internal static class VmStorageFixture
{
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLink(string name, string existing, IntPtr security);
    internal sealed class Source : IVmStorageSource
    {
        internal string PathName = @"C:\fixture-only\disk.vhdx";
        internal string Mode = "positive";
        internal bool Fail;
        internal Action Queried;
        public VmStorageAttachment[] ReadStorage()
        {
            if (Fail) throw new InvalidOperationException();
            if (Queried != null) Queried();
            var disk = new VmStorageAttachment("disk-id", "disk", "controller-id", "0", PathName);
            var dvd = new VmStorageAttachment("dvd-id", "dvd", "controller-id", "1", "");
            if (Mode == "empty") return new VmStorageAttachment[0];
            if (Mode == "missing") return null;
            if (Mode == "foreign-path") disk = new VmStorageAttachment("disk-id", "disk", "controller-id", "0", @"\\foreign\disk.vhdx");
            if (Mode == "ads") disk = new VmStorageAttachment("disk-id", "disk", "controller-id", "0", PathName + ":stream");
            if (Mode == "dot-path") disk = new VmStorageAttachment("disk-id", "disk", "controller-id", "0", @"C:\fixture-only\..\disk.vhdx");
            if (Mode == "unsupported") disk = new VmStorageAttachment("disk-id", "physical", "controller-id", "0", PathName);
            if (Mode == "empty-disk") disk = new VmStorageAttachment("disk-id", "disk", "controller-id", "0", "");
            if (Mode == "reconnected") disk = new VmStorageAttachment("disk-id", "disk", "controller-id", "2", PathName);
            if (Mode == "duplicate-id") return new VmStorageAttachment[] { disk, disk };
            if (Mode == "duplicate-path") dvd = new VmStorageAttachment("dvd-id", "dvd", "controller-id", "1", PathName);
            if (Mode == "null-row") return new VmStorageAttachment[] { disk, null };
            if (Mode == "quota") return new VmStorageAttachment[17];
            return Mode == "reordered" ? new VmStorageAttachment[] { dvd, disk } : new VmStorageAttachment[] { disk, dvd };
        }
    }
    internal sealed class Files : IEnrollmentFiles
    {
        internal const string VmSid = "S-1-5-83-0-1-2-3-4";
        internal bool DirectoryProtected = true;
        internal bool Standalone = true;
        internal string SecuritySddl = "O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;" + VmSid + ")";
        internal bool Changed, Link, Fail, Zero;
        internal string FileIdentity = new string('1', 32), Metadata = new string('2', 64);
        internal int Opened, Closed;
        internal int FailAt;
        public EnrollmentHeld Open(string path, bool directory)
        {
            if (Fail || (FailAt > 0 && Opened == FailAt)) throw new InvalidDataException();
            Opened++; return new File(this, path, directory);
        }
        private sealed class File : EnrollmentHeld
        {
            private readonly Files files; private readonly string name; private readonly bool directory;
            private bool closed;
            internal File(Files source, string path, bool dir) { files = source; name = path; directory = dir; }
            internal override string PathName { get { return name; } }
            internal override bool Directory { get { return directory; } }
            internal override bool Reparse { get { return files.Link; } }
            internal override string Volume { get { return files.Zero ? new string('0', 16) : new string('1', 16); } }
            internal override string FileId { get { return files.FileIdentity; } }
            internal override string BindingMetadata { get { return files.Metadata; } }
            internal override byte[] SecurityDescriptor {
                get {
                    if (files.SecuritySddl == null) return null;
                    var value = new System.Security.AccessControl.RawSecurityDescriptor(files.SecuritySddl);
                    var bytes = new byte[value.BinaryLength]; value.GetBinaryForm(bytes, 0); return bytes;
                }
            }
            internal override bool Protected(bool ancestor) { return files.DirectoryProtected; }
            internal override void RequireStandaloneDisk() { if (closed || directory || !files.Standalone) throw new InvalidDataException(); }
            internal override byte[] Read(int limit) { throw new InvalidOperationException(); }
            internal override void Recheck(bool ancestor) { if (closed || files.Changed) throw new InvalidDataException(); }
            public override void Dispose() { if (!closed) { closed = true; files.Closed++; } }
        }
    }
    private static string Bool(bool value) { return value ? "true" : "false"; }
    private static int Acl(string mode)
    {
        bool disk = mode != "dvd-read" && mode != "dvd-write";
        string text = new Files().SecuritySddl;
        if (mode == "dvd-read" || mode == "disk-read-only") text = text.Replace("FA;;;" + Files.VmSid, "0x1200a9;;;" + Files.VmSid);
        if (mode == "public-read") text += "(A;;FR;;;WD)";
        if (mode == "foreign-vm") text += "(A;;FA;;;S-1-5-83-0-5-6-7-8)";
        if (mode == "vm-owner") text = text.Replace("O:BA", "O:" + Files.VmSid);
        if (mode == "ordinary-owner") text = text.Replace("O:BA", "O:BU");
        if (mode == "inherited") text = text.Replace("D:P", "D:AI");
        if (mode == "missing-vm") text = "O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)";
        if (mode == "empty") text = "O:BAG:BAD:P";
        if (mode == "deny") text += "(D;;FR;;;WD)";
        if (mode == "inherit-only") text += "(A;OIIO;FA;;;WD)";
        var descriptor = new System.Security.AccessControl.RawSecurityDescriptor(text);
        if (mode == "null-dacl") descriptor = new System.Security.AccessControl.RawSecurityDescriptor(
            System.Security.AccessControl.ControlFlags.DiscretionaryAclPresent | System.Security.AccessControl.ControlFlags.DiscretionaryAclProtected,
            new System.Security.Principal.SecurityIdentifier("S-1-5-32-544"), null, null, null);
        if (mode == "callback") descriptor.DiscretionaryAcl.InsertAce(0, new System.Security.AccessControl.CommonAce(
            System.Security.AccessControl.AceFlags.None, System.Security.AccessControl.AceQualifier.AccessAllowed,
            1, new System.Security.Principal.SecurityIdentifier(Files.VmSid), true, new byte[0]));
        byte[] bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0);
        if (mode == "truncated") Array.Resize(ref bytes, 8);
        Console.WriteLine("{\"accepted\":" + Bool(VmStorageProtection.PrivateFile(bytes, Files.VmSid, disk)) + "}");
        return 0;
    }
    private static int NativeAcl(string root)
    {
        string path = System.IO.Path.Combine(root, "acl-snapshot.bin");
        System.IO.File.WriteAllText(path, "disposable ACL observation");
        bool isolated, refused = false;
        using (var held = new EnrollmentNative().Open(path, false))
        {
            byte[] first = held.SecurityDescriptor; first[0] ^= 1;
            isolated = first[0] != held.SecurityDescriptor[0]; held.Recheck(false);
            var acl = new System.Security.AccessControl.FileSecurity(); acl.SetAccessRuleProtection(true, false);
            using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
                acl.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(identity.User,
                    System.Security.AccessControl.FileSystemRights.FullControl, System.Security.AccessControl.AccessControlType.Allow));
            System.IO.File.SetAccessControl(path, acl);
            try { held.Recheck(false); } catch (InvalidDataException) { refused = true; }
        }
        System.IO.File.Delete(path);
        Console.WriteLine("{\"isolated\":" + Bool(isolated) + ",\"changedAclRefused\":" + Bool(refused) + ",\"cleanup\":true}");
        return 0;
    }
    private static int Main(string[] args)
    {
        if (args.Length < 1 || args.Length > 2) return 2;
        string mode = args[0];
        if (mode.StartsWith("image-", StringComparison.Ordinal)) return VmDiskImageFixture.Run(args[1], mode.Substring(6));
        if (mode.StartsWith("acl-", StringComparison.Ordinal)) return Acl(mode.Substring(4));
        if (mode.StartsWith("native", StringComparison.Ordinal)) return Native(args[1], mode);
        var source = new Source(); var files = new Files();
        bool acquired = false, checkedAgain = false, refusedAgain = false, changedDigest = false;
        string digest = null; VmStorageInspection held = null;
        if (mode.StartsWith("initial-", StringComparison.Ordinal)) source.Mode = mode.Substring(8);
        if (mode == "initial-link") files.Link = true;
        if (mode == "initial-zero") files.Zero = true;
        if (mode == "initial-file-failure") files.Fail = true;
        if (mode == "initial-partial-open") files.FailAt = 2;
        if (mode == "initial-metadata") files.Metadata = null;
        try
        {
            held = new VmStorageInspection(source, files); acquired = true; digest = held.Digest;
            if (mode == "changed-file") files.Changed = true;
            if (mode == "reconnected") source.Mode = "reconnected";
            if (mode == "outage") source.Fail = true;
            if (mode == "reordered") source.Mode = "reordered";
            if (mode == "changed-during-query") source.Queried = delegate { files.Changed = true; };
            try { held.CheckCurrent(); checkedAgain = true; } catch { }
            files.Changed = false; source.Fail = false; source.Mode = "positive"; source.Queried = null;
            try { held.CheckCurrent(); } catch { refusedAgain = true; }
            if (mode == "changed-identity" || mode == "changed-metadata")
            {
                held.Dispose(); held = null;
                if (mode == "changed-identity") files.FileIdentity = new string('3', 32);
                else files.Metadata = new string('3', 64);
                using (var replacement = new VmStorageInspection(source, files)) changedDigest = replacement.Digest != digest;
            }
        }
        catch { }
        finally { if (held != null) held.Dispose(); }
        Console.WriteLine("{\"acquired\":" + Bool(acquired) + ",\"checked\":" + Bool(checkedAgain) +
            ",\"refusedAgain\":" + Bool(refusedAgain) + ",\"changedDigest\":" + Bool(changedDigest) +
            ",\"opened\":" + files.Opened + ",\"closed\":" + files.Closed + "}");
        return 0;
    }
    private static int Native(string root, string mode)
    {
        if (mode == "native-acl-snapshot") return NativeAcl(root);
        string path = System.IO.Path.Combine(root, "disk.vhdx");
        System.IO.File.WriteAllText(path, "fixture bytes; not an actual virtual disk");
        var source = new Source(); source.PathName = path;
        if (mode == "native-writer" || mode == "native-hardlink")
        {
            bool refused = false;
            string link = System.IO.Path.Combine(root, "linked.vhdx");
            if (mode == "native-hardlink" && !CreateHardLink(link, path, IntPtr.Zero)) return 3;
            using (var writer = mode == "native-writer" ? new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite) : null)
                try { using (var lease = new VmStorageInspection(source, new EnrollmentNative())) { } }
                catch (InvalidOperationException) { refused = true; }
            if (mode == "native-hardlink") System.IO.File.Delete(link);
            // These deletions also verify failed construction released ancestors.
            System.IO.File.Delete(path);
            Console.WriteLine("{\"refused\":" + Bool(refused) + ",\"cleanup\":true}");
            return 0;
        }
        string digest;
        bool writeDenied = false, deleteDenied = false, replacementChanged;
        using (var lease = new VmStorageInspection(source, new EnrollmentNative()))
        {
            digest = lease.Digest; lease.CheckCurrent();
            try { using (var output = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) { } }
            catch (IOException) { writeDenied = true; }
            try { System.IO.File.Delete(path); } catch (IOException) { deleteDenied = true; }
            lease.CheckCurrent();
        }
        // Keep the old file present so its identity cannot be immediately reused.
        string old = System.IO.Path.Combine(root, "old.vhdx"); System.IO.File.Move(path, old);
        System.IO.File.WriteAllText(path, "fixture bytes; not an actual virtual disk");
        using (var replacement = new VmStorageInspection(source, new EnrollmentNative()))
            replacementChanged = replacement.Digest != digest;
        System.IO.File.WriteAllText(path, "write succeeds after lease closes");
        System.IO.File.Delete(path); System.IO.File.Delete(old);
        Console.WriteLine("{\"writeDenied\":" + Bool(writeDenied) + ",\"deleteDenied\":" + Bool(deleteDenied) +
            ",\"replacementChanged\":" + Bool(replacementChanged) + ",\"cleanup\":true}");
        return 0;
    }
}
