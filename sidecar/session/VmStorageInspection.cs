using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    internal interface IVmStorageSource { VmStorageAttachment[] ReadStorage(); }
    internal sealed class VmStorageAttachment
    {
        internal readonly string Id, Kind, Parent, Address, Path;
        internal VmStorageAttachment(string id, string kind, string parent, string address, string path)
        { Id = id; Kind = kind; Parent = parent; Address = address; Path = path; }
    }

    // Offline observation only. Handles deny write/delete sharing until disposal.
    // This binds attached file identities and metadata, not image provenance,
    // VHD parent chains, storage ownership, snapshots or live VM containment.
    internal sealed class VmStorageInspection : IDisposable
    {
        private readonly IVmStorageSource source;
        private readonly List<EnrollmentHeld> held = new List<EnrollmentHeld>();
        private readonly string topology;
        internal readonly string Digest;
        private bool closed, refused;
        internal VmStorageInspection(IVmStorageSource provider, IEnrollmentFiles files)
        {
            source = provider;
            try
            {
                if (source == null || files == null) throw new InvalidDataException();
                VmStorageAttachment[] rows = Ordered(source.ReadStorage());
                topology = Canonical(rows);
                var identities = new StringBuilder(topology);
                var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (VmStorageAttachment row in rows)
                {
                    if (row.Path == "") continue; // Empty virtual DVD tray.
                    string cursor = System.IO.Path.GetDirectoryName(row.Path);
                    int depth = 0;
                    while (!String.IsNullOrEmpty(cursor))
                    {
                        if (++depth > 32) throw new InvalidDataException();
                        if (directories.Add(cursor)) Hold(files, cursor, true);
                        string parent = System.IO.Path.GetDirectoryName(cursor);
                        if (String.Equals(parent, cursor, StringComparison.OrdinalIgnoreCase)) break;
                        cursor = parent;
                    }
                    EnrollmentHeld file = Hold(files, row.Path, false);
                    Field(identities, file.Volume); Field(identities, file.FileId);
                    string metadata = file.BindingMetadata;
                    if (metadata == null || !Regex.IsMatch(metadata, "\\A[a-f0-9]{64}\\z")) throw new InvalidDataException();
                    Field(identities, metadata);
                }
                Digest = EnrollmentInspection.ImageHash(new UTF8Encoding(false, true).GetBytes(identities.ToString()));
                CheckCurrent();
            }
            catch { Dispose(); throw new InvalidOperationException("installed-vm-storage-unavailable"); }
        }
        private EnrollmentHeld Hold(IEnrollmentFiles files, string path, bool directory)
        {
            EnrollmentHeld value = files.Open(path, directory);
            if (value == null) throw new InvalidDataException();
            held.Add(value);
            if (value.Directory != directory || value.Reparse ||
                !String.Equals(value.PathName, path, StringComparison.OrdinalIgnoreCase) ||
                value.Volume == null || !Regex.IsMatch(value.Volume, "\\A[a-f0-9]{16}\\z") ||
                value.FileId == null || !Regex.IsMatch(value.FileId, "\\A[a-f0-9]{32}\\z") ||
                value.Volume == new string('0', 16) || value.FileId == new string('0', 32)) throw new InvalidDataException();
            return value;
        }
        private static void Field(StringBuilder result, string value)
        {
            if (value == null || value.Length > 2048 || value.IndexOf('\0') >= 0) throw new InvalidDataException();
            result.Append(value.Length.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append(':').Append(value);
        }
        private static VmStorageAttachment[] Ordered(VmStorageAttachment[] rows)
        {
            if (rows == null || rows.Length < 1 || rows.Length > 16) throw new InvalidDataException();
            rows = (VmStorageAttachment[])rows.Clone();
            Array.Sort(rows, delegate(VmStorageAttachment a, VmStorageAttachment b) {
                if (a == null || b == null) throw new InvalidDataException();
                return StringComparer.Ordinal.Compare(a.Id, b.Id);
            });
            return rows;
        }
        private static string Canonical(VmStorageAttachment[] input)
        {
            VmStorageAttachment[] rows = Ordered(input);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var result = new StringBuilder("aegis-vm-storage-v1:");
            bool disk = false;
            foreach (VmStorageAttachment row in rows)
            {
                if (row == null || String.IsNullOrEmpty(row.Id) || !ids.Add(row.Id) ||
                    String.IsNullOrEmpty(row.Parent) || String.IsNullOrEmpty(row.Address) ||
                    (row.Kind != "disk" && row.Kind != "dvd") || row.Path == null) throw new InvalidDataException();
                if (row.Kind == "disk") { disk = true; if (row.Path == "") throw new InvalidDataException(); }
                if (row.Path != "")
                {
                    string path = row.Path;
                    if (path.Length < 4 || path.Length > 2048 || path[1] != ':' || path[2] != '\\' ||
                        !Char.IsLetter(path[0]) || path.IndexOf(':', 2) >= 0 || path.IndexOf('/') >= 0 ||
                        !String.Equals(System.IO.Path.GetFullPath(path), path, StringComparison.OrdinalIgnoreCase) ||
                        !paths.Add(path)) throw new InvalidDataException();
                }
                Field(result, row.Id); Field(result, row.Kind); Field(result, row.Parent);
                Field(result, row.Address); Field(result, row.Path.ToLowerInvariant());
            }
            if (!disk) throw new InvalidDataException();
            return result.ToString();
        }
        internal void CheckCurrent()
        {
            if (closed || refused) throw new InvalidOperationException("installed-vm-storage-unavailable");
            try
            {
                foreach (EnrollmentHeld file in held) file.Recheck(file.Directory);
                if (Canonical(source.ReadStorage()) != topology) throw new InvalidDataException();
                foreach (EnrollmentHeld file in held) file.Recheck(file.Directory);
            }
            catch { refused = true; throw new InvalidOperationException("installed-vm-storage-unavailable"); }
        }
        public void Dispose()
        {
            if (closed) return; closed = true;
            Exception failure = null;
            for (int index = held.Count - 1; index >= 0; index--)
                try { held[index].Dispose(); } catch (Exception error) { failure = error; }
            held.Clear();
            if (failure != null) throw new InvalidOperationException("installed-vm-storage-close-unavailable");
        }
    }
}
