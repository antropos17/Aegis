using System;
using System.Collections.Generic;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using Aegis.ProtectedSession;

internal static class EnrollmentFixture
{
    private static byte[] Descriptor(string sddl)
    {
        var descriptor = new RawSecurityDescriptor(sddl);
        byte[] bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0); return bytes;
    }
    private static readonly string Good = "O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FR;;;BU)";
    private sealed class Model : IEnrollmentFiles
    {
        internal readonly string Mode, Root;
        internal readonly List<Node> Opened = new List<Node>();
        internal readonly byte[] Image = Encoding.ASCII.GetBytes("fixed-binary-control");
        internal Model(string mode) { Mode = mode; Root = Path.Combine(Path.GetPathRoot(Path.GetTempPath()), "AEGIS-enrollment-model"); }
        public EnrollmentHeld Open(string path, bool directory)
        {
            if (Mode == "missing-record" && path.EndsWith("enrollment.json", StringComparison.Ordinal)) throw new IOException("dummy-secret-path");
            var node = new Node(this, path, directory); Opened.Add(node); return node;
        }
        internal byte[] Record()
        {
            string hash;
            using (SHA256 sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(Image)).Replace("-", "").ToLowerInvariant();
            string text = "{\"schemaVersion\":1,\"installId\":\"" + new string('a', 32) + "\",\"revision\":1," +
                "\"epoch\":\"" + new string('b', 32) + "\",\"rootVolumeSerial\":\"0000000000000001\",\"rootFileId\":\"" +
                new string('c', 32) + "\",\"supervisorSha256\":\"" + hash + "\",\"status\":\"active\"}";
            if (Mode == "root-id") text = text.Replace(new string('c', 32), new string('d', 32));
            if (Mode == "root-volume") text = text.Replace("0000000000000001", "0000000000000002");
            if (Mode == "image-hash") text = text.Replace(hash, new string('f', 64));
            if (Mode == "revoked") text = text.Replace("active", "revoked");
            if (Mode == "revision-zero") text = text.Replace("\"revision\":1", "\"revision\":0");
            if (Mode == "revision-overflow") text = text.Replace("\"revision\":1", "\"revision\":4294967296");
            if (Mode == "duplicate") text = text.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1");
            if (Mode == "unknown-field") text = text.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"launchAllowed\":true");
            if (Mode == "bom") text = "\uFEFF" + text;
            if (Mode == "oversize") text = new string('x', 1025);
            if (Mode == "invalid-utf8") return new byte[] { 0xC3, 0x28 };
            return Encoding.UTF8.GetBytes(text);
        }
    }
    private sealed class Node : EnrollmentHeld
    {
        private readonly Model owner; private readonly string path; private readonly bool directory;
        internal bool Closed;
        internal Node(Model model, string name, bool isDirectory) { owner = model; path = name; directory = isDirectory; }
        internal override string PathName { get { return owner.Mode == "path" && path == owner.Root ? path + "-sibling" : path; } }
        internal override string Volume { get { return "0000000000000001"; } }
        internal override string FileId { get { return new string('c', 32); } }
        internal override bool Directory { get { return directory; } }
        internal override bool Reparse { get { return owner.Mode == "reparse" && path == owner.Root; } }
        internal override bool Protected(bool ancestor)
        {
            string sddl = Good;
            if (owner.Mode == "world-writable" && path == owner.Root) sddl += "(A;;FW;;;WD)";
            if (owner.Mode == "owner-user" && path == owner.Root) sddl = sddl.Replace("O:SY", "O:BU");
            if (owner.Mode == "null-dacl" && path == owner.Root) sddl = "O:SYG:SY";
            return EnrollmentNative.ProtectedDescriptor(Descriptor(sddl), ancestor);
        }
        internal override byte[] Read(int maximum)
        { return path.EndsWith("enrollment.json", StringComparison.Ordinal) ? owner.Record() : owner.Image; }
        internal override void Recheck() { if (owner.Mode == "changed") throw new IOException("dummy-secret"); }
        public override void Dispose() { Closed = true; if (owner.Mode == "close") throw new IOException("dummy-secret"); }
    }
    private static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        try {
            if (args[0] == "native-ordinary-root") {
                string root = Path.Combine(Path.GetTempPath(), "aegis-enrollment-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(root);
                try {
                    bool protectedDescriptor;
                    using (EnrollmentHeld held = new EnrollmentNative().Open(root, true)) {
                        if (!held.Directory || held.Reparse || held.FileId.Length != 32 || held.Volume.Length != 16) return 1;
                        protectedDescriptor = held.Protected(false);
                    }
                    EnrollmentInspection nativeResult = EnrollmentInspection.Inspect(root, Path.Combine(root, "aegis-session.exe"), new EnrollmentNative());
                    if (nativeResult.Observed) return 1;
                    Console.WriteLine("{\"native\":true,\"ordinaryRootRefused\":true,\"heldIdentityObserved\":true,\"aclChanged\":false,\"protectedDescriptorObserved\":" + (protectedDescriptor ? "true" : "false") + "}");
                    return 0;
                }
                finally { Directory.Delete(root); }
            }
            if (args[0] == "native-held-file") {
                string root = Path.Combine(Path.GetTempPath(), "aegis-enrollment-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(root); string name = Path.Combine(root, "fixed.json");
                File.WriteAllText(name, "fixed-control", new UTF8Encoding(false));
                try {
                    using (EnrollmentHeld held = new EnrollmentNative().Open(name, false)) {
                        if (Encoding.UTF8.GetString(held.Read(1024)) != "fixed-control") return 1;
                        bool writeRefused = false, deleteRefused = false;
                        try { using (FileStream other = new FileStream(name, FileMode.Open, FileAccess.Write, FileShare.Read)) { } }
                        catch (IOException) { writeRefused = true; }
                        try { File.Delete(name); } catch (IOException) { deleteRefused = true; }
                        held.Recheck(); if (!writeRefused || !deleteRefused) return 1;
                    }
                    Console.WriteLine("{\"native\":true,\"heldBytesObserved\":true,\"writeRefused\":true,\"deleteRefused\":true,\"rechecked\":true}");
                    return 0;
                }
                finally { File.Delete(name); Directory.Delete(root); }
            }
            if (args[0] == "descriptor-controls") {
                string service = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
                var good = Descriptor(Good);
                if (!EnrollmentNative.ProtectedDescriptor(good, false)) return 1;
                foreach (string bad in new [] { "O:BUG:SYD:(A;;FA;;;SY)", "O:SYG:SY", Good + "(A;;WD;;;BU)", Good + "(A;;WO;;;BU)", Good + "(A;;GA;;;WD)" })
                    if (EnrollmentNative.ProtectedDescriptor(Descriptor(bad), false)) return 1;
                var ancestor = Descriptor("O:" + service + "G:SYD:(A;;FA;;;" + service + ")(A;;0x4;;;BU)");
                if (!EnrollmentNative.ProtectedDescriptor(ancestor, true) || EnrollmentNative.ProtectedDescriptor(ancestor, false)) return 1;
                if (EnrollmentNative.ProtectedDescriptor(Descriptor("O:SYG:SYD:(A;;GA;;;WD)"), true)) return 1;
                if (!EnrollmentNative.ProtectedDescriptor(Descriptor(Good + "(A;OIIO;GA;;;CO)"), true)) return 1;
                if (EnrollmentNative.ProtectedDescriptor(Descriptor(Good + "(A;OI;GA;;;CO)"), true)) return 1;
                Console.WriteLine("{\"native\":false,\"descriptorControls\":10,\"passed\":true,\"aclChanged\":false}"); return 0;
            }
            string mode = args[0];
            var model = new Model(mode);
            string image = Path.Combine(model.Root, mode == "running-image" ? "other.exe" : "aegis-session.exe");
            EnrollmentInspection result = EnrollmentInspection.Inspect(model.Root, image, model);
            bool expected = mode == "positive";
            if (result.Observed != expected) {
                Console.WriteLine("{\"assertion\":\"observed-mismatch\",\"observed\":" + (result.Observed ? "true" : "false") + "}");
                return 1;
            }
            if (model.Opened.Count == 0 || model.Opened.Exists(node => !node.Closed)) return 1;
            Console.WriteLine(result.Json()); return 0;
        }
        catch { return 1; }
    }
}
