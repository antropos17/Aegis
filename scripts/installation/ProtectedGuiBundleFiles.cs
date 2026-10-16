using System;
using System.Collections.Generic;
using System.IO;

// Administrative candidate intake. No GUI process or runtime is admitted.
public sealed class ProtectedGuiBundleFiles : IDisposable
{
    private sealed class Entry
    {
        internal readonly string Relative;
        internal readonly ProtectedGuiBundleNative Pin;
        internal readonly ProtectedGuiManifest.Row File;
        internal Entry(string relative, ProtectedGuiBundleNative pin, ProtectedGuiManifest.Row file)
        { Relative = relative; Pin = pin; File = file; }
    }
    private readonly object gate = new object();
    private readonly ProtectedGuiManifest manifest;
    private readonly List<Entry> entries = new List<Entry>();
    private readonly ProtectedInstallFile stageRoot;
    private readonly ProtectedInstallFile stageParent;
    private readonly ProtectedGuiIdentity principal;
    private string rootPath;
    private bool closed, refused, removed, transitioning;
    private ProtectedGuiBundleFiles(ProtectedGuiManifest value, string root, ProtectedInstallFile stage, ProtectedInstallFile parent, ProtectedGuiIdentity identity)
    { manifest = value; rootPath = root; stageRoot = stage; stageParent = parent; principal = identity; }
    private static void Need(bool value) { if (!value) throw ProtectedGuiBundleNative.Refused(); }
    private static string Child(string root, string relative)
    { return relative.Length == 0 ? root : Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)); }
    public string ManifestSha256 { get { return manifest.Digest; } }
    public int FileCount { get { return manifest.FileCount; } }
    public long TotalBytes { get { return manifest.TotalBytes; } }
    public string Executable { get { return ProtectedGuiManifest.ProductExecutable; } }
    public string Volume { get { lock (gate) { Need(!closed && entries.Count > 0); entries[0].Pin.Check(); return entries[0].Pin.Volume; } } }
    public string FileId { get { lock (gate) { Need(!closed && entries.Count > 0); entries[0].Pin.Check(); return entries[0].Pin.FileId; } } }
    public static ProtectedGuiBundleFiles Capture(string sourceRoot, byte[] manifest)
    {
        ProtectedGuiManifest parsed = ProtectedGuiManifest.Parse(manifest);
        string root = Path.GetFullPath(sourceRoot); var result = new ProtectedGuiBundleFiles(parsed, root, null, null, null);
        try
        {
            result.entries.Add(new Entry("", new ProtectedGuiBundleNative(root, true, false, null), null));
            foreach (string relative in parsed.Directories)
                result.entries.Add(new Entry(relative, new ProtectedGuiBundleNative(Child(root, relative), true, false, null), null));
            foreach (var file in parsed.Files)
                result.entries.Add(new Entry(file.Path, new ProtectedGuiBundleNative(Child(root, file.Path), false, false, null), file));
            result.CheckCurrent(); return result;
        }
        catch { result.Dispose(); throw; }
    }
    private void CheckTree()
    {
        var expected = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var entry in entries) if (entry.Relative.Length != 0) expected.Add(entry.Relative, entry.Pin.Directory);
        var observed = new Dictionary<string, bool>(StringComparer.Ordinal); var pending = new Queue<string>(); pending.Enqueue("");
        while (pending.Count > 0)
        {
            string relative = pending.Dequeue();
            foreach (string path in Directory.EnumerateFileSystemEntries(Child(rootPath, relative)))
            {
                string name = Path.GetFileName(path), child = relative.Length == 0 ? name : relative + "/" + name;
                ProtectedGuiManifest.ValidatePath(child); FileAttributes attributes = File.GetAttributes(path);
                Need((attributes & FileAttributes.ReparsePoint) == 0); bool directory = (attributes & FileAttributes.Directory) != 0, expectedDirectory;
                Need(expected.TryGetValue(child, out expectedDirectory) && expectedDirectory == directory && !observed.ContainsKey(child));
                observed.Add(child, directory); Need(observed.Count <= ProtectedGuiManifest.MaximumFiles + ProtectedGuiManifest.MaximumDirectories);
                if (directory) pending.Enqueue(child);
            }
        }
        Need(observed.Count == expected.Count);
    }
    private void CheckCore(bool complete, bool duringTransition = false)
    {
        Need(!closed && !refused && !removed && (!transitioning || duringTransition) && entries.Count > 0);
        if (stageRoot != null) { stageRoot.Recheck(); Need(rootPath == Path.Combine(stageRoot.PathName, "GuiBundle")); }
        foreach (var entry in entries)
        {
            entry.Pin.Check();
            if (stageRoot != null) Need(entry.Pin.Protected());
            if (complete && entry.File != null) Need(entry.Pin.Hash(entry.File.Bytes) == entry.File.Hash);
        }
        CheckTree();
        foreach (var entry in entries) entry.Pin.Check();
    }
    public void CheckCurrent()
    {
        lock (gate)
        {
            try { CheckCore(true); }
            catch { refused = true; throw ProtectedGuiBundleNative.Refused(); }
        }
    }
    public void CheckCurrent(ProtectedInstallFile originalStageRoot)
    {
        lock (gate)
        {
            try { Need(stageRoot != null && Object.ReferenceEquals(stageRoot, originalStageRoot)); CheckCore(true); }
            catch { refused = true; throw ProtectedGuiBundleNative.Refused(); }
        }
    }
    public ProtectedGuiBundleFiles Stage(ProtectedInstallFile originalStageRoot, byte[] protectedDescriptor, ProtectedInstallFile originalParent, ProtectedGuiIdentity originalPrincipal)
    {
        lock (gate)
        {
            CheckCurrent(); Need(originalStageRoot != null && originalParent != null && originalPrincipal != null &&
                (principal == null || Object.ReferenceEquals(principal, originalPrincipal)));
            originalStageRoot.Recheck(); originalParent.Recheck(); originalPrincipal.CheckCurrent();
            Need(originalStageRoot.Directory && originalParent.Directory && originalStageRoot.Volume == originalParent.Volume &&
                String.Equals(Path.GetDirectoryName(originalStageRoot.PathName), originalParent.PathName, StringComparison.OrdinalIgnoreCase));
#if PROTECTED_GUI_TEST
            if (!modelStageProtection)
#endif
            Need(originalStageRoot.Protected(false) && originalParent.Protected(false));
            string path = Path.Combine(originalStageRoot.PathName, "GuiBundle");
            var result = new ProtectedGuiBundleFiles(ProtectedGuiManifest.Parse(manifest.CopyBytes()), path, originalStageRoot, originalParent, originalPrincipal);
            try
            {
                result.entries.Add(new Entry("", new ProtectedGuiBundleNative(path, true, true, protectedDescriptor), null));
                foreach (string relative in manifest.Directories)
                    result.entries.Add(new Entry(relative, new ProtectedGuiBundleNative(Child(path, relative), true, true, protectedDescriptor), null));
                foreach (var file in manifest.Files)
                {
                    var target = new ProtectedGuiBundleNative(Child(path, file.Path), false, true, protectedDescriptor);
                    result.entries.Add(new Entry(file.Path, target, file));
                    Entry source = entries.Find(delegate(Entry entry) { return entry.Relative == file.Path; }); Need(source != null);
                    source.Pin.CopyTo(target, file.Bytes, file.Hash);
                }
                foreach (var entry in result.entries) if (entry.Pin.Directory) entry.Pin.FreezeDirectoryMetadata();
                CheckCurrent(); originalStageRoot.Recheck(); originalPrincipal.CheckCurrent(); result.CheckCurrent(originalStageRoot); return result;
            }
            catch
            {
                try { result.RemovePartial(); } catch {
                    var unknown = ProtectedGuiBundleNative.Unknown(); unknown.Data["protectedGuiOwner"] = result; throw unknown;
                }
                result.Dispose(); throw;
            }
        }
    }
    public void RenameStage(ProtectedInstallFile originalStageRoot, ProtectedInstallFile originalParent, string destination)
    {
        lock (gate)
        {
            Need(!transitioning && stageRoot != null && Object.ReferenceEquals(stageRoot, originalStageRoot) && Object.ReferenceEquals(stageParent, originalParent));
            principal.CheckCurrent(); CheckCore(true); stageParent.Recheck();
#if PROTECTED_GUI_TEST
            if (!modelStageProtection)
#endif
            Need(stageRoot.Protected(false) && stageParent.Protected(false));
            Need(destination != null && destination.Length <= 2048 && Path.IsPathRooted(destination) &&
                String.Equals(Path.GetDirectoryName(destination), stageParent.PathName, StringComparison.OrdinalIgnoreCase) &&
                !File.Exists(destination) && !Directory.Exists(destination));
            using (var hint = ProtectedGuiBundleNative.ParentHint(stageParent))
            {
                bool released = false; transitioning = true;
                try {
                    foreach (var entry in entries) { released = true; entry.Pin.Suspend(); }
                    stageRoot.Rename(destination, stageParent); rootPath = Path.Combine(stageRoot.PathName, "GuiBundle");
#if PROTECTED_GUI_TEST
                    InjectRenameForTest();
#endif
                    foreach (var entry in entries) entry.Pin.Resume(hint, Child(rootPath, entry.Relative));
                    CheckCore(true, true); stageParent.Recheck(); principal.CheckCurrent(); transitioning = false;
                } catch (Exception failure) {
                    transitioning = false;
                    if (released) { refused = true; throw ProtectedGuiBundleNative.Unknown(failure); }
                    throw;
                }
            }
        }
    }
    private void RemovePartial()
    {
        if (entries.Count == 0) { Need(!Directory.Exists(rootPath) && !File.Exists(rootPath)); return; }
        // Validate the complete actual creation journal before deleting anything.
        // Partial files may contain our incomplete copy, so no payload hash is required.
        stageRoot.Recheck(); CheckTree(); foreach (var entry in entries) entry.Pin.CheckOriginal(); CheckTree();
        for (int index = entries.Count - 1; index >= 0; index--) entries[index].Pin.DeleteOriginal(false, stageRoot, stageParent, 0, null);
        Need(!Directory.Exists(rootPath)); removed = true;
    }
    public void Remove(ProtectedInstallFile originalStageRoot)
    {
        lock (gate)
        {
            try
            {
                Need(stageRoot != null && Object.ReferenceEquals(stageRoot, originalStageRoot)); CheckCore(true);
                for (int index = entries.Count - 1; index >= 0; index--) {
                    Entry entry = entries[index]; entry.Pin.DeleteOriginal(true, stageRoot, stageParent, entry.File == null ? 0 : entry.File.Bytes, entry.File == null ? null : entry.File.Hash);
                }
                Need(!Directory.Exists(rootPath)); removed = true;
            }
            catch (Exception failure) { refused = true; throw ProtectedGuiBundleNative.Unknown(failure); }
        }
    }
    public void Dispose()
    {
        lock (gate)
        {
            Need(!transitioning); if (closed) return; closed = true;
            for (int index = entries.Count - 1; index >= 0; index--) entries[index].Pin.Dispose();
        }
    }
#if PROTECTED_GUI_TEST
    private static bool modelStageProtection = false;
    public static void ModelProtectionForTest()
    { modelStageProtection = true; ProtectedGuiBundleNative.ModelProtectionForTest = true; }
    private static string renameFailure = "";
    public static void SetRenameFailureForTest(string mode) { renameFailure = mode; }
    private void InjectRenameForTest()
    {
        string file = Child(rootPath, ProtectedGuiManifest.ProductExecutable);
        if (renameFailure == "replace") { File.Delete(file); File.WriteAllText(file, "foreign-replacement"); }
        else if (renameFailure == "missing") File.Delete(file);
        else if (renameFailure == "extra") File.WriteAllText(Child(rootPath, "foreign.canary"), "untouched");
        else if (renameFailure == "hash") File.WriteAllText(file, "mutated-payload");
        else if (renameFailure == "acl") {
            var acl = File.GetAccessControl(file); acl.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(
                new System.Security.Principal.SecurityIdentifier("S-1-1-0"), System.Security.AccessControl.FileSystemRights.Write,
                System.Security.AccessControl.AccessControlType.Allow)); File.SetAccessControl(file, acl);
        }
        else if (renameFailure == "principal") principal.Dispose();
        else if (renameFailure == "dispose") Dispose();
    }
#endif
}
