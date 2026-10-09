using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Aegis.ProtectedSession;

// Native opens, identities, reads, metadata rechecks and closes are real.
// Only acceptance of protected descriptors is modeled; no ACL is changed.
internal sealed class CompositionFiles : IEnrollmentFiles, IDisposable
{
    private readonly string root;
    internal volatile bool BlockRoot;
    internal readonly ManualResetEvent Entered = new ManualResetEvent(false), Continue = new ManualResetEvent(false);
    internal CompositionFiles(string selectedRoot) { root = selectedRoot; }
    public EnrollmentHeld Open(string path, bool directory)
    { return new Held(this, new EnrollmentNative().Open(path, directory)); }

    private sealed class Held : EnrollmentHeld
    {
        private readonly EnrollmentHeld native;
        private readonly CompositionFiles files;
        internal Held(CompositionFiles owner, EnrollmentHeld value) { files = owner; native = value; }
        internal override string PathName { get { return native.PathName; } }
        internal override string Volume { get { return native.Volume; } }
        internal override string FileId { get { return native.FileId; } }
        internal override bool Directory { get { return native.Directory; } }
        internal override bool Reparse { get { return native.Reparse; } }
        internal override bool Protected(bool ancestor) { return true; }
        internal override byte[] Read(int maximum) { return native.Read(maximum); }
        internal override void Recheck(bool ancestor)
        {
            native.Recheck(ancestor);
            if (files.BlockRoot && native.PathName == files.root)
            {
                files.Entered.Set();
                if (!files.Continue.WaitOne(1000)) throw new InvalidOperationException("fixture-check-barrier-timeout");
            }
        }
        public override void Dispose() { native.Dispose(); }
    }
    public void Dispose() { Continue.Set(); Entered.Dispose(); Continue.Dispose(); }

    internal static string Hash(string image)
    {
        using (SHA256 hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(image))).Replace("-", "").ToLowerInvariant();
    }
    internal static void WriteRecord(string root, string image)
    {
        using (EnrollmentHeld held = new EnrollmentNative().Open(root, true))
            File.WriteAllText(Path.Combine(root, "enrollment.json"),
                "{\"schemaVersion\":1,\"installId\":\"" + new string('a', 32) + "\",\"revision\":1," +
                "\"epoch\":\"" + new string('b', 32) + "\",\"rootVolumeSerial\":\"" + held.Volume +
                "\",\"rootFileId\":\"" + held.FileId + "\",\"supervisorSha256\":\"" + Hash(image) +
                "\",\"status\":\"active\"}", new UTF8Encoding(false));
    }
}
