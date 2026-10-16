using System;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // Retained protected installation records describe only the built-in read-only inspection.
    internal sealed class InstalledFixedOperationRegistration : IDisposable
    {
        internal const string FixtureId = "installed-inventory-inspection-v1";
        internal const string Operation = "inspect-owned";
        internal readonly string Generation = Guid.NewGuid().ToString("N");
        private readonly MainRegistrationEvidence proof;
        private readonly InstalledOwnerRegistration owner;
        private readonly InstalledOwnerPolicy policy;
        private readonly EnrollmentHeld[] held = new EnrollmentHeld[2];
        private readonly byte[][] records = new byte[2][];
        private readonly string[] volumes = new string[2], ids = new string[2];
        private AppContainerExecutable.PinnedFile supervisor;
        private Manifest manifest;
        private bool closed, cleanupUnknown;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private const string Hex32 = "([a-f0-9]{32})", Hex64 = "([a-f0-9]{64})", Size = "([1-9][0-9]{0,9})";
        private static readonly Regex Registration = new Regex("\\A\\{\"schemaVersion\":1,\"installId\":\"" + Hex32 +
            "\",\"revision\":" + Size + ",\"epoch\":\"" + Hex32 + "\",\"policySha256\":\"" + Hex64 +
            "\",\"operatorSid\":\"(S-1-(?:0|[1-9][0-9]{0,9})(?:-(?:0|[1-9][0-9]{0,9})){1,15})\"," +
            "\"selectionId\":\"" + Hex32 + "\",\"selectionEpoch\":\"" + Hex32 +
            "\",\"fixtureId\":\"" + FixtureId + "\",\"fixtureManifestBytes\":" + Size +
            ",\"fixtureManifestSha256\":\"" + Hex64 + "\",\"operations\":\\[\"inspect-owned\"\\],\"status\":\"active\"\\}\\z", RegexOptions.CultureInvariant);
        private static readonly Regex Fixture = new Regex("\\A\\{\"schemaVersion\":1,\"fixtureId\":\"" + FixtureId +
            "\",\"scope\":\"retained-inventory-inspection\",\"selectionId\":\"" + Hex32 +
            "\",\"selectionEpoch\":\"" + Hex32 + "\",\"inventoryBytes\":" + Size + ",\"inventorySha256\":\"" + Hex64 +
            "\",\"mainImageBytes\":" + Size + ",\"mainImageSha256\":\"" + Hex64 +
            "\",\"supervisorImageBytes\":" + Size + ",\"supervisorImageSha256\":\"" + Hex64 + "\"\\}\\z", RegexOptions.CultureInvariant);

        internal sealed class Manifest
        {
            internal readonly string SelectionId, SelectionEpoch, InventoryHash, MainHash, SupervisorHash;
            internal readonly int InventorySize, MainSize, SupervisorSize;
            internal Manifest(Match value)
            {
                SelectionId = value.Groups[1].Value; SelectionEpoch = value.Groups[2].Value;
                InventorySize = BoundedSize(value.Groups[3].Value, 4096); InventoryHash = value.Groups[4].Value;
                MainSize = BoundedSize(value.Groups[5].Value, 4 * 1024 * 1024); MainHash = value.Groups[6].Value;
                SupervisorSize = BoundedSize(value.Groups[7].Value, 4 * 1024 * 1024); SupervisorHash = value.Groups[8].Value;
            }
        }
        private InstalledFixedOperationRegistration(MainRegistrationEvidence original, InstalledOwnerRegistration installed)
        { proof = original; owner = installed; policy = installed.Policy; }
        internal static InstalledFixedOperationRegistration Acquire(MainRegistrationEvidence proof,
            InstalledOwnerRegistration installed, IEnrollmentFiles files)
        {
            CallerNative.Require(proof != null && installed != null && files != null);
            var registration = new InstalledFixedOperationRegistration(proof, installed); var watch = Stopwatch.StartNew();
            try
            {
                proof.CheckCurrent(); installed.CheckCurrent(); Deadline(watch);
                string[] names = { "registered-operation.json", "fixed-fixture.json" };
                for (int index = 0; index < names.Length; index++)
                {
                    string path = Path.Combine(proof.InstalledRoot, names[index]);
                    registration.held[index] = files.Open(path, false);
                    EnrollmentInspection.Check(registration.held[index], path, false, false);
                    registration.volumes[index] = registration.held[index].Volume; registration.ids[index] = registration.held[index].FileId;
                    registration.records[index] = Read(registration.held[index]); Deadline(watch);
                }
                registration.manifest = Parse(registration.records[0], registration.records[1], registration.policy);
                registration.supervisor = AppContainerExecutable.Open(Path.Combine(proof.InstalledRoot, "aegis-session.exe"),
                    registration.manifest.SupervisorSize, registration.manifest.SupervisorHash);
                registration.CheckCurrent(); Deadline(watch); return registration;
            }
            catch { registration.Dispose(); throw; }
        }
        private static int BoundedSize(string text, int maximum)
        { int size; CallerNative.Require(Int32.TryParse(text, out size) && size > 0 && size <= maximum); return size; }
        private static Manifest Parse(byte[] operation, byte[] fixture, InstalledOwnerPolicy policy)
        {
            CallerNative.Require(policy != null && operation != null && operation.Length > 0 && operation.Length <= 4096 &&
                fixture != null && fixture.Length > 0 && fixture.Length <= 4096);
            Match registered = Registration.Match(Utf8.GetString(operation)), fixedFixture = Fixture.Match(Utf8.GetString(fixture));
            uint revision = 0;
            CallerNative.Require(registered.Success && fixedFixture.Success && UInt32.TryParse(registered.Groups[2].Value, out revision));
            // SecurityIdentifier canonicalization rejects numeric overflow and alternate SID spellings.
            CallerNative.Require(new SecurityIdentifier(registered.Groups[5].Value).Value == registered.Groups[5].Value &&
                registered.Groups[1].Value == policy.InstallId && revision == policy.Revision && registered.Groups[3].Value == policy.Epoch &&
                registered.Groups[4].Value == policy.Digest && registered.Groups[5].Value == policy.OperatorSid &&
                registered.Groups[6].Value == policy.SelectionId && registered.Groups[7].Value == policy.SelectionEpoch &&
                BoundedSize(registered.Groups[8].Value, 4096) == fixture.Length &&
                registered.Groups[9].Value == EnrollmentInspection.ImageHash(fixture));
            var manifest = new Manifest(fixedFixture);
            CallerNative.Require(manifest.SelectionId == policy.SelectionId && manifest.SelectionEpoch == policy.SelectionEpoch &&
                manifest.MainSize == policy.MainSize && manifest.MainHash == policy.MainHash &&
                manifest.SupervisorSize == policy.SupervisorSize && manifest.SupervisorHash == policy.SupervisorHash);
            return manifest;
        }
#if CALLER_MAIN_OPERATION_TEST
        // Parser observations issue no registration or dispatch authority.
        internal static void ParseForTest(byte[] operation, byte[] fixture, InstalledOwnerPolicy policy)
        { Parse(operation, fixture, policy); }
#endif
        internal void CheckCurrent()
        {
            var watch = Stopwatch.StartNew();
            try
            {
                CallerNative.Require(!closed && !CallerNative.HasThreadToken() && Object.ReferenceEquals(owner.Policy, policy));
                owner.CheckCurrent(); policy.CheckCurrent(); proof.CheckCurrent(); Deadline(watch);
                string[] names = { "registered-operation.json", "fixed-fixture.json" };
                for (int index = 0; index < held.Length; index++)
                {
                    EnrollmentInspection.Check(held[index], Path.Combine(proof.InstalledRoot, names[index]), false, false);
                    CallerNative.Require(held[index].Volume == volumes[index] && held[index].FileId == ids[index]);
                    held[index].Recheck(false); byte[] current = Read(held[index]);
                    try
                    {
                        CallerNative.Require(current.Length == records[index].Length);
                        for (int at = 0; at < current.Length; at++) CallerNative.Require(current[at] == records[index][at]);
                    }
                    finally { Array.Clear(current, 0, current.Length); }
                    Deadline(watch);
                }
                proof.CheckFixedInspectionBinding(policy, manifest, supervisor);
                CallerNative.Require(!CallerNative.HasThreadToken()); Deadline(watch);
            }
            catch { Dispose(); throw; }
        }
        internal void CheckOwner(InstalledOwnerRegistration expected)
        {
            try { CallerNative.Require(Object.ReferenceEquals(owner, expected)); CheckCurrent(); }
            catch { Dispose(); throw; }
        }
        internal void RequireOperation(string operation)
        {
            try { CallerNative.Require(!closed && operation == Operation); }
            catch { Dispose(); throw; }
        }
        private static byte[] Read(EnrollmentHeld value)
        { byte[] bytes = value.Read(4096); CallerNative.Require(bytes != null && bytes.Length > 0 && bytes.Length <= 4096); return bytes; }
        private static void Deadline(Stopwatch watch) { CallerNative.Require(watch.ElapsedMilliseconds < 2000); }
        private void CloseResource(IDisposable value) { if (value != null) try { value.Dispose(); } catch { cleanupUnknown = true; } }
        public void Dispose()
        {
            if (!closed)
            {
                closed = true; CloseResource(supervisor);
                for (int index = held.Length - 1; index >= 0; index--) CloseResource(held[index]);
                foreach (byte[] bytes in records) if (bytes != null) Array.Clear(bytes, 0, bytes.Length);
            }
            if (cleanupUnknown) throw new InvalidDataException("fixed-inspection-registration-cleanup-unconfirmed");
        }
    }
}
