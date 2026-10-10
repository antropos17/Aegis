using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    internal sealed partial class CallerRegistration
    {
        internal void CheckEnrolledImage(AppContainerExecutable.PinnedFile image)
        { CheckCurrent(); CallerNative.Require(image != null && image.IsPinned && image.MatchesProcessImage(process.DangerousGetHandle())); }
        internal void CheckEnrolledOperator(string sid, string authentication, uint session)
        { CheckCurrent(); CallerNative.Require(identity.MatchesOperator(sid, authentication, session)); }
    }

    // Private native proof, never reconstructible from a frame or copied record.
    internal sealed class MainRegistrationEvidence : IDisposable
    {
        private readonly EnrollmentLease lease;
        private readonly CallerRegistration server, main;
        private readonly EnrollmentInspection.Identity enrollment;
        private readonly EnrollmentHeld[] held = new EnrollmentHeld[3];
        private readonly byte[][] records = new byte[2][];
        private AppContainerExecutable.PinnedFile image;
        private string[] ids, epochs;
        private string operatorSid, operatorAuthentication;
        private uint operatorSession;
        private bool closed, cleanupUnknown;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private const string Header = "\\A\\{\"schemaVersion\":1,\"installId\":\"([a-f0-9]{32})\",\"revision\":([1-9][0-9]{0,9}),\"epoch\":\"([a-f0-9]{32})\",";
        private static readonly Regex Role = new Regex(Header +
            "\"role\":\"controller-main\",\"protocol\":\"aegis-supervisor-caller\",\"protocolVersion\":1," +
            "\"operatorSid\":\"(S-1-(?:0|[1-9][0-9]{0,9})(?:-(?:0|[1-9][0-9]{0,9})){1,15})\"," +
            "\"operatorAuthentication\":\"([a-f0-9]{16})\",\"operatorSession\":(0|[1-9][0-9]{0,9})," +
            "\"mainImageSize\":([1-9][0-9]{0,8}),\"mainImageSha256\":\"([a-f0-9]{64})\",\"inventorySha256\":\"([a-f0-9]{64})\"\\}\\z", RegexOptions.CultureInvariant);
        private const string Entry = "\\{\"id\":\"([a-f0-9]{32})\",\"epoch\":\"([a-f0-9]{32})\",\"operation\":\"inspect-owned\"\\}";
        private static readonly Regex Inventory = new Regex(Header + "\"selections\":\\[(" + Entry + ")(?:," + Entry + "){0,7}\\]\\}\\z", RegexOptions.CultureInvariant);
        private static readonly Regex Entries = new Regex(Entry, RegexOptions.CultureInvariant);
        private MainRegistrationEvidence(EnrollmentLease original, CallerRegistration exactServer, CallerRegistration exactMain)
        { lease = original; server = exactServer; main = exactMain; enrollment = lease.BindServer(server); }

        internal static MainRegistrationEvidence Acquire(EnrollmentLease lease, CallerRegistration server,
            CallerRegistration main, IEnrollmentFiles files)
        {
            var proof = new MainRegistrationEvidence(lease, server, main); var watch = Stopwatch.StartNew();
            try
            {
                string[] names = { "main-registration.json", "inventory.json", "aegis-main.exe" };
                for (int index = 0; index < names.Length; index++)
                {
                    string path = Path.Combine(proof.enrollment.Root, names[index]);
                    proof.held[index] = files.Open(path, false);
                    EnrollmentInspection.Check(proof.held[index], path, false, false);
                    Deadline(watch);
                }
                proof.records[0] = Read(proof.held[0], 2048); proof.records[1] = Read(proof.held[1], 4096);
                Match role = Role.Match(Utf8.GetString(proof.records[0])), inventory = Inventory.Match(Utf8.GetString(proof.records[1]));
                proof.CheckTuple(role); proof.CheckTuple(inventory);
                int size;
                EnrollmentNative.Require(Int32.TryParse(role.Groups[7].Value, out size) && size <= 128 * 1024 * 1024 &&
                    EnrollmentInspection.ImageHash(proof.records[1]) == role.Groups[9].Value &&
                    UInt32.TryParse(role.Groups[6].Value, out proof.operatorSession));
                proof.operatorSid = role.Groups[4].Value; proof.operatorAuthentication = role.Groups[5].Value;
                MatchCollection entries = Entries.Matches(Utf8.GetString(proof.records[1]));
                proof.ids = new string[entries.Count]; proof.epochs = new string[entries.Count];
                for (int index = 0; index < entries.Count; index++)
                {
                    proof.ids[index] = entries[index].Groups[1].Value; proof.epochs[index] = entries[index].Groups[2].Value;
                    for (int previous = 0; previous < index; previous++)
                        EnrollmentNative.Require(proof.ids[index] != proof.ids[previous]);
                }
                proof.image = AppContainerExecutable.Open(Path.Combine(proof.enrollment.Root, names[2]), size, role.Groups[8].Value);
                proof.CheckCurrent(); Deadline(watch); return proof;
            }
            catch { proof.Dispose(); throw; }
            finally { watch.Stop(); }
        }
        private void CheckTuple(Match record)
        {
            uint revision;
            EnrollmentNative.Require(record.Success && UInt32.TryParse(record.Groups[2].Value, out revision) &&
                revision == enrollment.Revision && record.Groups[1].Value == enrollment.InstallId && record.Groups[3].Value == enrollment.Epoch);
        }
        private static byte[] Read(EnrollmentHeld value, int maximum)
        {
            byte[] bytes = value.Read(maximum);
            EnrollmentNative.Require(bytes != null && bytes.Length > 0 && bytes.Length <= maximum); return bytes;
        }
        internal void CheckCurrent()
        {
            EnrollmentNative.Require(!closed && ReferenceEquals(enrollment, lease.BindServer(server)));
            var watch = Stopwatch.StartNew();
            try
            {
                main.CheckMain(server); main.CheckEnrolledOperator(operatorSid, operatorAuthentication, operatorSession);
                for (int index = 0; index < held.Length; index++) { held[index].Recheck(false); Deadline(watch); }
                for (int index = 0; index < records.Length; index++)
                {
                    byte[] current = Read(held[index], index == 0 ? 2048 : 4096);
                    try
                    {
                        EnrollmentNative.Require(current.Length == records[index].Length);
                        for (int at = 0; at < current.Length; at++) EnrollmentNative.Require(current[at] == records[index][at]);
                    }
                    finally { Array.Clear(current, 0, current.Length); }
                    Deadline(watch);
                }
                main.CheckEnrolledImage(image); server.CheckCurrent();
                EnrollmentNative.Require(!CallerNative.HasThreadToken()); Deadline(watch);
            }
            finally { watch.Stop(); }
        }
        internal void CheckSelection(CallerAdmission.Context context)
        {
            EnrollmentNative.Require(context != null && context.InventoryRevision == enrollment.Revision);
            for (int index = 0; index < ids.Length; index++)
                if (ids[index] == context.SelectionId && epochs[index] == context.SelectionEpoch) return;
            throw new InvalidDataException("main-selection-unavailable");
        }
        internal string Inspect(CallerAdmission.Context context)
        {
            CheckSelection(context);
            return "{\"schemaVersion\":1,\"scope\":\"retained-inventory-inspection\",\"selectionId\":\"" + context.SelectionId +
                "\",\"revision\":" + enrollment.Revision + ",\"epoch\":\"" + context.SelectionEpoch +
                "\",\"inventoryObserved\":true,\"ownershipQualified\":false,\"launchAllowed\":false}";
        }
        private static void Deadline(Stopwatch watch) { EnrollmentNative.Require(watch.ElapsedMilliseconds < 2000); }
        private void CloseResource(IDisposable value)
        { if (value != null) try { value.Dispose(); } catch { cleanupUnknown = true; } }
        public void Dispose()
        {
            if (!closed)
            {
                closed = true; CloseResource(image);
                for (int index = held.Length - 1; index >= 0; index--) CloseResource(held[index]);
                foreach (byte[] bytes in records) if (bytes != null) Array.Clear(bytes, 0, bytes.Length);
            }
            if (cleanupUnknown) throw new InvalidDataException("main-evidence-cleanup-unconfirmed");
        }
    }
}
