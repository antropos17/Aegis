using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using Aegis.ProtectedSession;

// Original process registration/file pins are native where stated. Installed
// authority, VM/configuration/storage observations and dummy digests are modeled.
internal static class RuntimeCandidateFixture
{
    private sealed class File : EnrollmentHeld, IEnrollmentFiles
    {
        internal byte[] Bytes;
        internal bool Trusted = true, Changed, Closed, Missing;
        internal string Id = new string('1', 32);
        private readonly string path;
        internal File(string root, string leaf, byte[] bytes) { path = Path.Combine(root, leaf); Bytes = bytes; }
        public EnrollmentHeld Open(string selected, bool directory) { if (Missing || selected != path || directory) throw new FileNotFoundException(); return this; }
        internal override string PathName { get { return path; } }
        internal override string Volume { get { return new string('1', 16); } }
        internal override string FileId { get { return Id; } }
        internal override bool Directory { get { return false; } }
        internal override bool Reparse { get { return false; } }
        internal override bool Protected(bool ancestor) { return Trusted; }
        internal override byte[] Read(int maximum) { if (Closed || Bytes.Length > maximum) throw new InvalidDataException(); return (byte[])Bytes.Clone(); }
        internal override void Recheck(bool ancestor) { if (Closed || Changed) throw new InvalidDataException(); }
        public override void Dispose() { Closed = true; }
    }
    private sealed class Provider : IVmManagement, IVmStorageSource, IVmConfigurationSource
    {
        internal readonly VmStorageFixture.Source Storage = new VmStorageFixture.Source();
        internal int Observations, Requests;
        internal ushort State = 3;
        internal string Configuration = RuntimeCandidateRecords.ConfigurationHash, Identity = RuntimeCandidateRecords.Identity;
        public Guid VmId { get { return RuntimeCandidateRecords.VmId; } }
        public VmObservation Inspect() { Observations++; return new VmObservation(VmId, Identity, State); }
        public VmConfigurationObservation ReadConfiguration() { return new VmConfigurationObservation(VmId, Identity, VmConfigurationProfile.Name, Configuration); }
        public VmStorageAttachment[] ReadStorage() { return Storage.ReadStorage(); }
        public VmMethodResult RequestState(ushort state) { Requests++; throw new InvalidOperationException(); }
        public VmJobObservation InspectJob(string path) { Requests++; throw new InvalidOperationException(); }
        public void Wait() { }
        public void Dispose() { }
    }
    private static bool Refused(Action action) { try { action(); return false; } catch (InvalidOperationException) { return true; } }
    private static string Bool(bool value) { return value ? "true" : "false"; }
    private static int Parse(string mode)
    {
        bool accepted = false, isolated = false;
        try
        {
            var value = RuntimeCandidateCodec.Parse(RuntimeCandidateRecords.Bytes(RuntimeCandidateRecords.Candidate("S-1-5-21-1"), mode));
            string[] copy = value.Arguments;
            if (copy.Length > 0) { string original = copy[0]; copy[0] = "mutated-copy"; isolated = value.Arguments[0] == original; }
            else isolated = true;
            accepted = true;
        }
        catch (InvalidDataException) { }
        Console.WriteLine("{\"accepted\":" + Bool(accepted) + ",\"isolated\":" + Bool(isolated) + "}"); return 0;
    }
    private static int Reader(string mode, string root)
    {
        bool ownerValid = true, callerValid = true, acquired = false, current = false, revived = false;
        var storageFiles = new VmStorageFixture.Files(); var provider = new Provider();
        string storageHash;
        using (var storage = new VmStorageInspection(provider.Storage, storageFiles)) storageHash = storage.Digest;
        VmStorageProtection.ResolveForTest = delegate(Guid vm) { return VmStorageFixture.Files.VmSid; };
        using (var process = Process.GetCurrentProcess())
        using (var server = new CallerRegistration(process.Handle, new string('a', 32)))
        using (var policy = InstalledOwnerPolicy.CreateForTest(root, RuntimeCandidateRecords.Install, 1, RuntimeCandidateRecords.Epoch,
            "S-1-5-21-1", RuntimeCandidateRecords.Selection, RuntimeCandidateRecords.SelectionEpoch, RuntimeCandidateRecords.PolicyHash,
            1, new string('a', 64), 1, new string('b', 64)))
        using (var owner = InstalledOwnerRegistration.CreateForTest(policy, server, process.Handle, delegate { if (!ownerValid) throw new InvalidOperationException(); }))
        {
            string record = RuntimeCandidateRecords.Vm(storageHash);
            if (mode == "legacy") record = record.Replace("\"schemaVersion\":4", "\"schemaVersion\":3")
                .Replace(",\"configurationProfile\":\"" + VmConfigurationProfile.Name + "\",\"configurationSha256\":\"" + RuntimeCandidateRecords.ConfigurationHash + "\"", "");
            var registered = new File(root, "registered-vm.json", RuntimeCandidateRecords.Utf8.GetBytes(record));
            using (var inspection = InstalledVmRegistration.PrepareCandidateForTest(root, owner, registered, delegate(Guid id) { return provider; }, storageFiles))
            {
                if (mode != "unbound") inspection.BindForTest(delegate { if (!callerValid) throw new InvalidOperationException(); });
                string text = RuntimeCandidateRecords.Candidate(policy.OperatorSid);
                if (mode == "stale-install") text = text.Replace(RuntimeCandidateRecords.Install, new string('a', 32));
                if (mode == "stale-revision") text = text.Replace("\"revision\":1", "\"revision\":2");
                if (mode == "stale-epoch") text = text.Replace(RuntimeCandidateRecords.Epoch, new string('a', 32));
                if (mode == "stale-policy") text = text.Replace(RuntimeCandidateRecords.PolicyHash, new string('a', 64));
                if (mode == "stale-operator") text = text.Replace(policy.OperatorSid, "S-1-5-21-2");
                if (mode == "stale-selection") text = text.Replace(RuntimeCandidateRecords.Selection, new string('a', 32));
                if (mode == "stale-selection-epoch") text = text.Replace(RuntimeCandidateRecords.SelectionEpoch, new string('a', 32));
                if (mode == "stale-config") text = text.Replace(RuntimeCandidateRecords.ConfigurationHash, new string('a', 64));
                if (mode == "stale-vm") text = text.Replace(RuntimeCandidateRecords.VmId.ToString("D"), "aaaaaaaa-2222-3333-4444-555555555555");
                var candidateFile = new File(root, "runtime-candidate.json", RuntimeCandidateRecords.Utf8.GetBytes(text));
                candidateFile.Missing = mode == "missing"; candidateFile.Trusted = mode != "unprotected";
                IEnrollmentFiles files = candidateFile; CompositionFiles native = null;
                if (mode.StartsWith("native-", StringComparison.Ordinal))
                {
                    System.IO.File.WriteAllBytes(Path.Combine(root, "runtime-candidate.json"), candidateFile.Bytes);
                    if (mode == "native-unprotected") files = new EnrollmentNative();
                    else { native = new CompositionFiles(root) { BlockRoot = false }; files = native; }
                }
                InstalledRuntimeCandidate candidate = null; InstalledOwnerRegistration other = null;
                int observedBefore = provider.Observations;
                try
                {
                    if (mode == "foreign-owner") other = InstalledOwnerRegistration.CreateForTest(policy, server, process.Handle, delegate { });
                    candidate = InstalledRuntimeCandidate.AcquireForTest(other ?? owner, inspection, root, files); acquired = true;
                    if (mode == "native-pins")
                    {
                        bool writeDenied = false, deleteDenied = false;
                        string path = Path.Combine(root, "runtime-candidate.json");
                        try { using (var stream = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) { } } catch (IOException) { writeDenied = true; }
                        try { System.IO.File.Delete(path); } catch (IOException) { deleteDenied = true; }
                        if (!writeDenied || !deleteDenied) throw new InvalidDataException();
                    }
                    if (mode == "owner-loss") ownerValid = false;
                    if (mode == "caller-loss") callerValid = false;
                    if (mode == "leaf-replaced") candidateFile.Id = new string('2', 32);
                    if (mode == "leaf-metadata") candidateFile.Changed = true;
                    if (mode == "leaf-unprotected") candidateFile.Trusted = false;
                    if (mode == "leaf-bytes") candidateFile.Bytes = RuntimeCandidateRecords.Utf8.GetBytes(text.Replace("marker=one", "marker=two"));
                    if (mode == "extra-arguments") candidateFile.Bytes = RuntimeCandidateRecords.Utf8.GetBytes(text.Replace("\"marker=one\"]", "\"marker=one\",\"extra\"]"));
                    if (mode == "vm-record") registered.Bytes = RuntimeCandidateRecords.Utf8.GetBytes(record + " ");
                    if (mode == "configuration-loss") provider.Configuration = new string('a', 64);
                    if (mode == "state-loss") provider.State = 2;
                    if (mode == "identity-loss") provider.Identity = "replaced";
                    current = !Refused(candidate.CheckCurrent);
                    ownerValid = callerValid = true; candidateFile.Id = new string('1', 32); candidateFile.Changed = false; candidateFile.Trusted = true;
                    candidateFile.Bytes = RuntimeCandidateRecords.Utf8.GetBytes(text); registered.Bytes = RuntimeCandidateRecords.Utf8.GetBytes(record);
                    provider.Configuration = RuntimeCandidateRecords.ConfigurationHash; provider.State = 3; provider.Identity = RuntimeCandidateRecords.Identity;
                    revived = !Refused(candidate.CheckCurrent);
                }
                catch (InvalidOperationException) { }
                finally { if (candidate != null) candidate.Dispose(); if (other != null) other.Dispose(); if (native != null) native.Dispose(); }
                bool sharedAlive = mode == "positive" && !Refused(owner.CheckCurrent) && !Refused(delegate { inspection.Inspect(); });
                Console.WriteLine("{\"acquired\":" + Bool(acquired) + ",\"current\":" + Bool(current) + ",\"revived\":" + Bool(revived) +
                    ",\"requests\":" + provider.Requests + ",\"fresh\":" + Bool(provider.Observations > observedBefore) + ",\"sharedAlive\":" + Bool(sharedAlive) + "}");
            }
        }
        return 0;
    }
    private static int Production(string path)
    {
        var assembly = Assembly.LoadFrom(path); bool absent = true;
        foreach (Type type in assembly.GetTypes())
            foreach (MethodInfo method in type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance))
                if ((type.Name == "InstalledRuntimeCandidate" || type.Name == "InstalledVmRegistration") &&
                    (method.Name == "AcquireForTest" || method.Name == "PrepareCandidateForTest")) absent = false;
        var candidate = assembly.GetType("Aegis.ProtectedSession.InstalledRuntimeCandidate", true);
        foreach (var constructor in candidate.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)) absent &= constructor.IsPrivate;
        foreach (var method in candidate.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static))
            absent &= method.Name != "Approve" && method.Name != "Launch" && method.Name != "Dispatch";
        var inspection = assembly.GetType("Aegis.ProtectedSession.InstalledVmInspection", true);
        absent &= inspection.GetMethod("CheckCandidateBinding", BindingFlags.NonPublic | BindingFlags.Instance).ReturnType == typeof(void);
        Console.WriteLine("{\"testFactoriesAbsent\":" + Bool(absent) + "}"); return 0;
    }
    private static int Main(string[] args)
    {
        if (args.Length < 1 || args.Length > 2) return 2;
        if (args[0].StartsWith("parse-", StringComparison.Ordinal)) return Parse(args[0].Substring(6));
        if (args.Length != 2) return 2;
        if (args[0] == "production") return Production(args[1]);
        return Reader(args[0], args[1]);
    }
}
