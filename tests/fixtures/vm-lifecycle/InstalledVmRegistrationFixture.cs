using System;
using System.IO;
using System.Text;
using Aegis.ProtectedSession;

// Contract test only. No VM or installed service is created by this fixture.
internal static class InstalledVmRegistrationFixture
{
    private const string Install = "11111111111111111111111111111111";
    private const string Epoch = "22222222222222222222222222222222";
    private const string Digest = "3333333333333333333333333333333333333333333333333333333333333333";
    private const string Selection = "44444444444444444444444444444444";
    private const string SelectionEpoch = "55555555555555555555555555555555";
    private static readonly Guid Id = new Guid("11111111-2222-3333-4444-555555555555");
    private const string Identity = "msvm_computersystem.creationclassname=\"Msvm_ComputerSystem\",name=\"11111111-2222-3333-4444-555555555555\"\nMicrosoft:settings-generation";
    private sealed class File : EnrollmentHeld, IEnrollmentFiles
    {
        internal byte[] Bytes;
        internal bool Trusted = true, Link, Changed, Closed;
        internal int Opens;
        internal string Root;
        internal File(string root, string text) { Root = root; Bytes = Encoding.UTF8.GetBytes(text); }
        public EnrollmentHeld Open(string path, bool directory) { Opens++; return this; }
        internal override string PathName { get { return Path.Combine(Root, "registered-vm.json"); } }
        internal override string Volume { get { return "1111111111111111"; } }
        internal override string FileId { get { return Install; } }
        internal override bool Directory { get { return false; } }
        internal override bool Reparse { get { return Link; } }
        internal override bool Protected(bool ancestor) { return Trusted; }
        internal override byte[] Read(int maximum) { if (Bytes.Length > maximum) throw new InvalidDataException(); return (byte[])Bytes.Clone(); }
        internal override void Recheck(bool ancestor) { if (Closed || Changed) throw new InvalidDataException(); }
        public override void Dispose() { Closed = true; }
    }
    private sealed class Provider : IVmManagement, IVmStorageSource
    {
        internal readonly VmStorageFixture.Source Storage = new VmStorageFixture.Source();
        public VmStorageAttachment[] ReadStorage() { return Storage.ReadStorage(); }
        internal string Actual = Identity;
        internal Guid IdValue = Id;
        internal ushort State = 3;
        internal bool Closed;
        internal int Requests, JobRequests;
        internal Action Dispatched;
        public Guid VmId { get { return IdValue; } }
        internal int Observations;
        public VmObservation Inspect() { Observations++; if (Dispatched != null) Dispatched(); return new VmObservation(VmId, Actual, State); }
        public VmMethodResult RequestState(ushort state)
        { Requests++; State = state; if (Dispatched != null) Dispatched(); return new VmMethodResult(0, null); }
        public VmJobObservation InspectJob(string path) { JobRequests++; return new VmJobObservation(path, 7, 0); }
        public void Wait() { }
        public void Dispose() { Closed = true; }
    }
    private static string Record()
    {
        return "{\"schemaVersion\":1,\"installId\":\"" + Install + "\",\"revision\":1,\"epoch\":\"" + Epoch +
            "\",\"policySha256\":\"" + Digest + "\",\"selectionId\":\"" + Selection + "\",\"selectionEpoch\":\"" + SelectionEpoch +
            "\",\"vmId\":\"" + Id.ToString("D") + "\",\"identitySha256\":\"" + EnrollmentInspection.ImageHash(Encoding.UTF8.GetBytes(Identity)) +
            "\",\"status\":\"active\"}";
    }
    private static string Boolean(bool value) { return value ? "true" : "false"; }
    private static int Main(string[] args)
    {
        if (args.Length < 1 || args.Length > 2) return 2;
        string mode = args[0], root = args.Length == 2 ? args[1] : @"C:\contract-only";
        string text = Record();
        var storageFiles = new VmStorageFixture.Files();
        var storageSource = new VmStorageFixture.Source();
        string storageHash;
        using (var storage = new VmStorageInspection(storageSource, storageFiles)) storageHash = storage.Digest;
        if (mode.StartsWith("storage-", StringComparison.Ordinal) || mode.StartsWith("protected-", StringComparison.Ordinal) || mode == "prepared-slow")
            text = text.Replace("\"schemaVersion\":1", "\"schemaVersion\":2").Replace("\"status\":\"active\"",
                "\"storageSha256\":\"" + storageHash + "\",\"status\":\"active\"");
        if (mode.StartsWith("protected-", StringComparison.Ordinal))
        {
            VmStorageProtection.ResolveForTest = delegate(Guid vm) { if (vm != Id) throw new InvalidOperationException(); return VmStorageFixture.Files.VmSid; };
            text = text.Replace("\"schemaVersion\":2", "\"schemaVersion\":3")
                .Replace("\"status\":\"active\"", "\"storageProtection\":\"private-vm\",\"status\":\"active\"");
            if (mode == "protected-world") storageFiles.SecuritySddl += "(A;;FR;;;WD)";
            if (mode == "protected-foreign-vm") storageFiles.SecuritySddl += "(A;;FA;;;S-1-5-83-0-5-6-7-8)";
            if (mode == "protected-owner") storageFiles.SecuritySddl = storageFiles.SecuritySddl.Replace("O:BA", "O:BU");
            if (mode == "protected-directory") storageFiles.DirectoryProtected = false;
            if (mode == "protected-missing-sid") storageFiles.SecuritySddl = "O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)";
            if (mode == "protected-malformed") text = text.Replace("private-vm", "trusted");
            if (mode == "protected-parent-disk") storageFiles.Standalone = false;
        }
        if (mode == "storage-initial-replacement") storageFiles.FileIdentity = new string('3', 32);
        if (mode == "storage-initial-metadata") storageFiles.Metadata = new string('3', 64);
        if (mode == "storage-malformed") text = text.Replace(storageHash, "invalid");
        if (mode == "prepared-slow")
        {
            var preparedFile = new File(root, text); var preparedProvider = new Provider();
            bool first = true;
            preparedProvider.Storage.Queried = delegate { if (first) { first = false; System.Threading.Thread.Sleep(2200); } };
            using (var prepared = InstalledVmRegistration.PrepareForTest(root, Install, 1, Epoch, Digest, Selection, SelectionEpoch,
                delegate { }, preparedFile, delegate(Guid id) { return preparedProvider; }, storageFiles))
            {
                bool unboundRefused = false; try { prepared.Inspect(); } catch { unboundRefused = true; }
                var admission = System.Diagnostics.Stopwatch.StartNew();
                prepared.BindForTest(delegate { if (admission.ElapsedMilliseconds >= 2000) throw new InvalidOperationException(); });
                bool accepted = prepared.Inspect() != null;
                Console.WriteLine("{\"unboundRefused\":" + Boolean(unboundRefused) + ",\"accepted\":" + Boolean(accepted) + ",\"requests\":" + preparedProvider.Requests + "}");
            }
            return 0;
        }
        string expectedDigest = Digest;
        if (mode == "record" || mode == "storage-record") { Console.WriteLine(text); return 0; }
        if (mode == "from-producer")
        {
            text = System.IO.File.ReadAllText(Path.Combine(root, "registered-vm.json"));
            if (text.StartsWith("{\"schemaVersion\":3,", StringComparison.Ordinal))
                VmStorageProtection.ResolveForTest = delegate(Guid vm) { if (vm != Id) throw new InvalidOperationException(); return VmStorageFixture.Files.VmSid; };
            expectedDigest = EnrollmentInspection.ImageHash(System.IO.File.ReadAllBytes(Path.Combine(root, "owner-policy.json")));
        }
        bool? nativeProtected = null;
        if (mode == "native-unprotected")
        {
            string path = Path.Combine(root, "registered-vm.json");
            var acl = new System.Security.AccessControl.FileSecurity();
            using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
                acl.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(identity.User,
                    System.Security.AccessControl.FileSystemRights.FullControl,
                    System.Security.AccessControl.AccessControlType.Allow));
            acl.SetAccessRuleProtection(true, false);
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            using (var output = new FileStream(path, FileMode.CreateNew,
                System.Security.AccessControl.FileSystemRights.Write, FileShare.None, 4096, FileOptions.None, acl))
                output.Write(bytes, 0, bytes.Length);
            using (var observed = new EnrollmentNative().Open(path, false))
                nativeProtected = observed.Protected(false);
        }
        if (mode == "stale-install") text = text.Replace(Install, new string('a', 32));
        if (mode == "stale-revision") text = text.Replace("\"revision\":1", "\"revision\":2");
        if (mode == "stale-epoch") text = text.Replace(Epoch, new string('a', 32));
        if (mode == "stale-policy") text = text.Replace(Digest, new string('a', 64));
        if (mode == "stale-selection") text = text.Replace(Selection, new string('a', 32));
        if (mode == "stale-selection-epoch") text = text.Replace(SelectionEpoch, new string('a', 32));
        if (mode == "revoked") text = text.Replace("active", "revoked");
        if (mode == "extra-field") text = text.Replace("}", ",\"vmName\":\"foreign\"}");
        if (mode == "zero-vm") text = text.Replace(Id.ToString("D"), Guid.Empty.ToString("D"));
        if (mode == "duplicate-field") text = text.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1");
        if (mode == "overflow-revision") text = text.Replace("\"revision\":1", "\"revision\":4294967296");
        if (mode == "oversized") text = new string('a', 4097);
        if (mode == "invalid-utf8") text = "bad";
        if (mode == "unconfigured" || mode == "stale-unconfigured")
        {
            text = text.Substring(0, text.IndexOf("\"vmId\"", StringComparison.Ordinal)) + "\"status\":\"unconfigured\"}";
            if (mode == "stale-unconfigured") text = text.Replace("\"revision\":1", "\"revision\":2");
        }
        var file = new File(root, text); var provider = new Provider();
        if (mode == "invalid-utf8") file.Bytes = new byte[] { 0xc0, 0xaf };
        if (mode == "unprotected") file.Trusted = false;
        if (mode == "reparse") file.Link = true;
        if (mode == "initial-replacement") provider.Actual = "replacement";
        if (mode == "initial-foreign") provider.IdValue = Guid.NewGuid();
        bool authority = mode != "unadmitted", acquired = false, inspected = false, refusedAgain = false;
        int constructed = 0;
        InstalledVmInspection owner = null;
        try
        {
            IEnrollmentFiles files = mode == "native-unprotected" ? (IEnrollmentFiles)new EnrollmentNative() : file;
            owner = InstalledVmRegistration.AcquireForTest(root, Install, 1, Epoch, expectedDigest, Selection, SelectionEpoch,
                delegate { if (!authority) throw new InvalidOperationException(); }, files,
                delegate(Guid id) { constructed++; if (id != Id) throw new InvalidOperationException(); return provider; }, storageFiles);
            acquired = owner != null;
            if (owner == null) return PrintUnconfigured(file, constructed);
            if (mode == "lost-authority") authority = false;
            if (mode == "replaced-vm") provider.Actual = "replacement";
            if (mode == "replaced-file") file.Changed = true;
            if (mode == "changed-bytes") file.Bytes[10] ^= 1;
            if (mode == "lost-after-observation") provider.Dispatched = delegate { authority = false; };
            if (mode == "storage-changed-file") storageFiles.Changed = true;
            if (mode == "storage-reconnected") provider.Storage.Mode = "reconnected";
            if (mode == "storage-outage") provider.Storage.Fail = true;
            if (mode == "storage-running") provider.State = 2;
            if (mode == "protected-changed-acl") storageFiles.SecuritySddl += "(A;;FR;;;WD)";
            if (mode == "protected-lost-disk-observation") storageFiles.Standalone = false;
            try { inspected = owner.Inspect() != null; } catch { }
            if (mode != "positive" && mode != "from-producer" && mode != "storage-positive")
            {
                authority = true; file.Changed = false; file.Bytes = Encoding.UTF8.GetBytes(text); provider.Actual = Identity;
                storageFiles.Changed = false; provider.Storage.Mode = "positive"; provider.Storage.Fail = false; provider.State = 3;
                storageFiles.SecuritySddl = new VmStorageFixture.Files().SecuritySddl;
                storageFiles.Standalone = true;
                try { owner.Inspect(); } catch { refusedAgain = true; }
            }
        }
        catch { }
        finally { if (owner != null) owner.Dispose(); }
        Console.WriteLine("{\"acquired\":" + Boolean(acquired) + ",\"inspected\":" + Boolean(inspected) + ",\"refusedAgain\":" + Boolean(refusedAgain) +
            ",\"constructed\":" + constructed + ",\"requests\":" + provider.Requests + ",\"jobRequests\":" + provider.JobRequests +
            ",\"nativeProtected\":" + (nativeProtected.HasValue ? Boolean(nativeProtected.Value) : "null") +
            ",\"observations\":" + provider.Observations + ",\"opened\":" + file.Opens + ",\"fileClosed\":" + Boolean(file.Closed) + ",\"providerClosed\":" + Boolean(provider.Closed) + "}");
        return 0;
    }
    private static int PrintUnconfigured(File file, int constructed)
    {
        Console.WriteLine("{\"acquired\":false,\"configured\":false,\"constructed\":" + constructed + ",\"requests\":0,\"fileClosed\":" + Boolean(file.Closed) + "}");
        return 0;
    }
}
