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
    private sealed class Provider : IVmManagement
    {
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
        if (mode == "native-unprotected")
        {
            string path = Path.Combine(root, "registered-vm.json");
            System.IO.File.WriteAllText(path, text, new UTF8Encoding(false));
            var acl = new System.Security.AccessControl.FileSecurity();
            var sid = System.Security.Principal.WindowsIdentity.GetCurrent().User;
            acl.SetOwner(sid); acl.SetAccessRuleProtection(true, false);
            acl.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(sid,
                System.Security.AccessControl.FileSystemRights.FullControl,
                System.Security.AccessControl.AccessControlType.Allow));
            System.IO.File.SetAccessControl(path, acl);
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
            owner = InstalledVmRegistration.AcquireForTest(root, Install, 1, Epoch, Digest, Selection, SelectionEpoch,
                delegate { if (!authority) throw new InvalidOperationException(); }, files,
                delegate(Guid id) { constructed++; if (id != Id) throw new InvalidOperationException(); return provider; });
            acquired = true;
            if (mode == "lost-authority") authority = false;
            if (mode == "replaced-vm") provider.Actual = "replacement";
            if (mode == "replaced-file") file.Changed = true;
            if (mode == "changed-bytes") file.Bytes[10] ^= 1;
            if (mode == "lost-after-observation") provider.Dispatched = delegate { authority = false; };
            try { inspected = owner.Inspect() != null; } catch { }
            if (mode != "positive")
            {
                authority = true; file.Changed = false; file.Bytes = Encoding.UTF8.GetBytes(Record()); provider.Actual = Identity;
                try { owner.Inspect(); } catch { refusedAgain = true; }
            }
        }
        catch { }
        finally { if (owner != null) owner.Dispose(); }
        Console.WriteLine("{\"acquired\":" + Boolean(acquired) + ",\"inspected\":" + Boolean(inspected) + ",\"refusedAgain\":" + Boolean(refusedAgain) +
            ",\"constructed\":" + constructed + ",\"requests\":" + provider.Requests + ",\"jobRequests\":" + provider.JobRequests +
            ",\"observations\":" + provider.Observations + ",\"opened\":" + file.Opens + ",\"fileClosed\":" + Boolean(file.Closed) + ",\"providerClosed\":" + Boolean(provider.Closed) + "}");
        return 0;
    }
}
