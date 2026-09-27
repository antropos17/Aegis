using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

// Private, bounded inventory. Immutable flushed records make an interrupted
// transition explicit; no record is ever used as authority to delete a path.
internal sealed class AppContainerWorkspaceInventory : IDisposable
{
    private const int MaxRecords = 256;
    private const int MaxPathBytes = 4096;
    private static readonly Regex RecordName = new Regex(
        @"^ws-[a-f0-9]{32}\.(intent|identity|retained)$", RegexOptions.CultureInvariant);
    private static readonly Regex Identity = new Regex(@"^[a-f0-9]{48}$", RegexOptions.CultureInvariant);
    private readonly AppContainerProfile.WorkspaceJournalLease journal;
    private readonly string id;
    private readonly string path;
    private string identity;
#if APPCONTAINER_TEST
    internal static bool CrashIdentityTransitionForTest;
    internal static bool CrashIntentTransitionForTest;
#endif

    private AppContainerWorkspaceInventory(AppContainerProfile.WorkspaceJournalLease owner,
        string recordId, string selectedPath, string committedIdentity)
    { journal = owner; id = recordId; path = selectedPath; identity = committedIdentity; }

    private sealed class Record
    {
        internal string Id, Path, Identity;
        internal long Created;
        internal bool Retained, PendingIdentity, PendingRetained;
    }

    private static string Name(string directory, string id, string suffix)
    { return Path.Combine(directory, "ws-" + id + "." + suffix); }

    private static void WriteNew(string selected, byte[] bytes)
    {
        string temporary = selected + ".tmp";
        using (FileStream file = new FileStream(temporary, FileMode.CreateNew,
            FileAccess.Write, FileShare.None))
        {
            file.Write(bytes, 0, bytes.Length);
            file.Flush(true);
        }
        AppContainerProfile.ValidatePrivateJournalFile(temporary);
#if APPCONTAINER_TEST
        if (CrashIntentTransitionForTest && selected.EndsWith(".intent",
            StringComparison.Ordinal)) Environment.Exit(2);
        if (CrashIdentityTransitionForTest && selected.EndsWith(".identity",
            StringComparison.Ordinal)) Environment.Exit(2);
#endif
        File.Move(temporary, selected);
    }

    private static byte[] ReadBounded(string selected, int maximum)
    {
        AppContainerProfile.ValidatePrivateJournalFile(selected);
        using (FileStream file = new FileStream(selected, FileMode.Open, FileAccess.Read,
            FileShare.Read))
        {
            if (file.Length < 0 || file.Length > maximum)
                throw new InvalidDataException("workspace-journal-record-size");
            byte[] bytes = new byte[(int)file.Length];
            int total = 0;
            while (total < bytes.Length)
            {
                int count = file.Read(bytes, total, bytes.Length - total);
                if (count <= 0) throw new InvalidDataException("workspace-journal-record-short");
                total += count;
            }
            if (file.ReadByte() != -1)
                throw new InvalidDataException("workspace-journal-record-growth");
            return bytes;
        }
    }

    private static SortedDictionary<string, Record> ReadAll(string directory,
        bool explicitList, out int incompleteIntents)
    {
        SortedDictionary<string, Record> records = new SortedDictionary<string, Record>(
            StringComparer.Ordinal);
        HashSet<string> incompleteIds = new HashSet<string>(StringComparer.Ordinal);
        int count = 0;
        incompleteIntents = 0;
        foreach (string selected in Directory.EnumerateFileSystemEntries(directory))
        {
            if (++count > MaxRecords * 6 + 1)
                throw new InvalidDataException("workspace-journal-full");
            string filename = Path.GetFileName(selected);
            if (filename == ".lock") continue;
            bool temporary = filename.EndsWith(".tmp", StringComparison.Ordinal);
            string basename = temporary ? filename.Substring(0, filename.Length - 4) : filename;
            if (!RecordName.IsMatch(basename) || (temporary && !explicitList))
                throw new InvalidDataException("workspace-journal-name-invalid");
            string key = basename.Substring(3, 32);
            string suffix = basename.Substring(36);
            if (temporary && suffix == "intent")
            {
                AppContainerProfile.ValidatePrivateJournalFile(selected);
                if (new FileInfo(selected).Length > MaxPathBytes + 17)
                    throw new InvalidDataException("workspace-intent-incomplete-size");
                if (!incompleteIds.Add(key) || ++incompleteIntents > MaxRecords)
                    throw new InvalidDataException("workspace-intent-incomplete-count");
                continue;
            }
            Record record;
            if (!records.TryGetValue(key, out record))
            {
                record = new Record(); record.Id = key; records.Add(key, record);
                if (records.Count > MaxRecords)
                    throw new InvalidDataException("workspace-journal-full");
            }
            if (temporary)
            {
                AppContainerProfile.ValidatePrivateJournalFile(selected);
                if (new FileInfo(selected).Length > 48)
                    throw new InvalidDataException("workspace-transition-incomplete");
                if (suffix == "identity") record.PendingIdentity = true;
                else record.PendingRetained = true;
                continue;
            }
            byte[] bytes = ReadBounded(selected, suffix == "intent" ? MaxPathBytes + 17 : 48);
            if (suffix == "intent")
            {
                if (record.Path != null || bytes.Length < 18)
                    throw new InvalidDataException("workspace-intent-invalid");
                using (MemoryStream stream = new MemoryStream(bytes, false))
                using (BinaryReader reader = new BinaryReader(stream, new UTF8Encoding(false, true)))
                {
                    if (Encoding.ASCII.GetString(reader.ReadBytes(5)) != "AEGW1")
                        throw new InvalidDataException("workspace-intent-invalid");
                    record.Created = reader.ReadInt64();
                    int size = reader.ReadInt32();
                    if (record.Created <= 0 || record.Created > DateTime.MaxValue.Ticks ||
                        size < 1 || size > MaxPathBytes ||
                        stream.Length - stream.Position != size)
                        throw new InvalidDataException("workspace-intent-invalid");
                    record.Path = new UTF8Encoding(false, true).GetString(reader.ReadBytes(size));
                    AppContainerWorkspace.ValidatePath(record.Path);
                }
            }
            else if (suffix == "identity")
            {
                if (record.Identity != null || bytes.Length != 48)
                    throw new InvalidDataException("workspace-identity-invalid");
                record.Identity = Encoding.ASCII.GetString(bytes);
                if (!Identity.IsMatch(record.Identity))
                    throw new InvalidDataException("workspace-identity-invalid");
            }
            else
            {
                if (record.Retained || bytes.Length != 0)
                    throw new InvalidDataException("workspace-retained-invalid");
                record.Retained = true;
            }
        }
        foreach (Record record in records.Values)
            if (record.Path == null || (record.Retained && record.Identity == null) ||
                (record.PendingIdentity && record.Identity != null) ||
                (record.PendingRetained && (record.Retained || record.Identity == null)) ||
                (record.PendingIdentity && record.PendingRetained))
                throw new InvalidDataException("workspace-journal-transition-invalid");
        foreach (string key in incompleteIds)
            if (records.ContainsKey(key))
                throw new InvalidDataException("workspace-journal-transition-invalid");
        return records;
    }

    internal static AppContainerWorkspaceInventory Begin(string selected)
    {
        AppContainerWorkspace.ValidatePath(selected);
#if APPCONTAINER_TEST
        CrashIntentTransitionForTest = Path.GetFileName(selected) ==
            "inventory-intent-tmp-workspace";
#endif
        AppContainerProfile.WorkspaceJournalLease journal =
            AppContainerProfile.OpenWorkspaceJournal(true);
        try
        {
            int incomplete;
            if (ReadAll(journal.DirectoryPath, false, out incomplete).Count >= MaxRecords)
                throw new InvalidDataException("workspace-journal-full");
            string id = Guid.NewGuid().ToString("N");
            byte[] pathBytes = new UTF8Encoding(false, true).GetBytes(selected);
            if (pathBytes.Length > MaxPathBytes)
                throw new InvalidDataException("workspace-path-too-long");
            using (MemoryStream stream = new MemoryStream())
            using (BinaryWriter writer = new BinaryWriter(stream, Encoding.UTF8))
            {
                writer.Write(Encoding.ASCII.GetBytes("AEGW1"));
                writer.Write(DateTime.UtcNow.Ticks);
                writer.Write(pathBytes.Length);
                writer.Write(pathBytes);
                writer.Flush();
                WriteNew(Name(journal.DirectoryPath, id, "intent"), stream.ToArray());
            }
#if APPCONTAINER_TEST
            if (Path.GetFileName(selected) == "inventory-intent-crash-workspace")
                Environment.Exit(2);
#endif
            return new AppContainerWorkspaceInventory(journal, id, selected, null);
        }
        catch { journal.Dispose(); throw; }
    }

    internal void Commit(AppContainerWorkspace workspace)
    {
        string token = workspace.IdentityToken();
        WriteNew(Name(journal.DirectoryPath, id, "identity"), Encoding.ASCII.GetBytes(token));
        identity = token;
    }

#if APPCONTAINER_TEST
    internal void CorruptCommittedIdentityForTest()
    {
        File.WriteAllText(Name(journal.DirectoryPath, id, "identity"), "corrupt");
    }
#endif

    internal bool Revalidate(AppContainerWorkspace workspace)
    {
        if (identity == null || !string.Equals(workspace.IdentityToken(), identity,
            StringComparison.Ordinal)) return false;
        Record record;
        int incomplete;
        return ReadAll(journal.DirectoryPath, false, out incomplete).TryGetValue(id, out record) &&
            string.Equals(record.Path, path, StringComparison.Ordinal) &&
            string.Equals(record.Identity, identity, StringComparison.Ordinal) &&
            !record.Retained;
    }

    internal bool MarkRetained(AppContainerWorkspace workspace)
    {
        try
        {
            if (!Revalidate(workspace)) return false;
            WriteNew(Name(journal.DirectoryPath, id, "retained"), new byte[0]);
            return true;
        }
        catch { return false; }
    }

    internal static string ListJson()
    {
        using (AppContainerProfile.WorkspaceJournalLease journal =
            AppContainerProfile.OpenWorkspaceJournal(false))
        {
            List<object> rows = new List<object>();
            int incompleteIntents;
            SortedDictionary<string, Record> records = ReadAll(journal.DirectoryPath,
                true, out incompleteIntents);
            foreach (Record record in records.Values)
                rows.Add(new {
                    id = record.Id,
                    path = record.Path,
                    createdUtc = new DateTime(record.Created, DateTimeKind.Utc).ToString("o"),
                    phase = record.Retained ? "retained" : record.Identity == null ? "intent" : "prepared",
                    presence = record.PendingIdentity || record.PendingRetained ||
                        record.Identity == null ? "unknown" :
                        AppContainerWorkspace.Inspect(record.Path, record.Identity)
                });
            return new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 }
                .Serialize(new { schemaVersion = 1, incompleteIntents = incompleteIntents,
                    workspaces = rows });
        }
    }

    public void Dispose() { journal.Dispose(); }
}
