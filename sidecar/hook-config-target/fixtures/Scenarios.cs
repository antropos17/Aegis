using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Text;
using static Aegis.HookConfigTarget.Fixtures.Program;

namespace Aegis.HookConfigTarget.Fixtures;

internal static class Scenarios
{
    private static readonly byte[] Before = Encoding.UTF8.GetBytes("{\r\n  \"owned\": \"原文\"\r\n}\r\n");
    private static readonly byte[] After = Encoding.UTF8.GetBytes("{\"owned\":\"new\"}\n");

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLinkW(string newName, string existingName, nint security);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle file,
        int kind, in Native.Basic metadata, uint size);

    internal static void Run()
    {
        Scenario("native-layouts", () => {
            Assert(Marshal.SizeOf<Native.Identity>() == 24, "identity-layout");
            Assert(Marshal.SizeOf<Native.Standard>() == 24, "standard-layout");
            Assert(Marshal.SizeOf<Native.Basic>() == 40, "basic-layout");
        });
        Scenario("exact-write-identity-metadata", ExactWrite);
        Scenario("empty-and-max-boundary", Boundaries);
        Scenario("external-edit-is-stale-zero-mutation", StaleBytes);
        Scenario("replacement-identical-bytes-is-stale", Replacement);
        Scenario("already-open-writer-refused", ExistingWriter);
        Scenario("guard-refuses-child-write-delete", GuardExclusion);
        Scenario("parent-rename-refused-through-review", ParentPinned);
        Scenario("invalid-and-oversize-refused", Invalid);
        Scenario("hardlink-refused", Hardlink);
        Scenario("symlink-refused-when-permitted", Symlink);
        Scenario("postwrite-fault-retained-unknown", PostwriteFault);
        Scenario("readback-mismatch-retained-unknown", ReadbackFault);
        Scenario("dispose-releases-all-handles", Disposal);
        CreateScenarios.Run();
        DeleteScenarios.Run();
    }

    private static TargetCode Commit(TargetLease lease, byte[] after) =>
        lease.CompareAndWrite(lease.Identity, lease.CopyBeforeBytes(), after);

    private static void ExactWrite()
    {
        string file = MakeFile("exact.json", Before);
        File.SetAttributes(file, FileAttributes.Hidden | FileAttributes.NotContentIndexed);
        var created = DateTime.UtcNow.AddDays(-3);
        File.SetCreationTimeUtc(file, created);
        File.SetLastWriteTimeUtc(file, created.AddHours(1));
        using (var setup = Native.Open(file, Native.Read | Native.Write,
            Native.ShareRead | Native.ShareWrite | Native.ShareDelete, false))
        {
            var change = new Native.Basic { Change = created.ToFileTimeUtc() };
            Assert(SetFileInformationByHandle(setup, 0, in change, 40), "set-owned-fixture-old-change-time");
        }
        using var lease = Open(file);
        using var witness = Native.Open(file, Native.Read,
            Native.ShareRead | Native.ShareWrite | Native.ShareDelete, false);
        var metadata = Native.Inspect(witness, file, false);
        byte[] security = new FileInfo(file).GetAccessControl(AccessControlSections.Access |
            AccessControlSections.Owner | AccessControlSections.Group).GetSecurityDescriptorBinaryForm();
        Assert(lease.CopyBeforeBytes().SequenceEqual(Before), "snapshot-exact");
        byte[] copied = lease.CopyBeforeBytes(); copied[0] ^= 1;
        Assert(lease.CopyBeforeBytes().SequenceEqual(Before), "snapshot-copy-isolation");
        Assert(Commit(lease, After) == TargetCode.Written, "written");
        var afterMetadata = Native.Inspect(witness, file, false);
        Assert(afterMetadata.Id == metadata.Id, "same-file-id");
        Assert(afterMetadata.Metadata.Creation == metadata.Metadata.Creation, "creation-preserved-after-guard-close");
        Assert(afterMetadata.Metadata.Write > metadata.Metadata.Write, "write-time-signals-success-after-guard-close");
        Assert(afterMetadata.Metadata.Change > metadata.Metadata.Change, "change-time-signals-success-after-guard-close");
        Assert(afterMetadata.Metadata.Attributes == metadata.Metadata.Attributes, "attributes-preserved-after-guard-close");
        Assert(Native.ReadExact(witness, afterMetadata.State.Length).SequenceEqual(After), "after-exact");
        Assert(new FileInfo(file).GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner |
            AccessControlSections.Group).GetSecurityDescriptorBinaryForm().SequenceEqual(security), "security-preserved");
        Assert(lease.CompareAndWrite(lease.Identity, Before, After) == TargetCode.Closed, "single-attempt");
    }

    private static void Boundaries()
    {
        string file = MakeFile("boundary.json", []);
        using (var lease = Open(file)) Assert(Commit(lease, new byte[TargetLease.MaxBytes]) == TargetCode.Written, "max-write");
        using (var lease = Open(file)) Assert(Commit(lease, []) == TargetCode.Written, "empty-write");
        Assert(new FileInfo(file).Length == 0, "empty-exact");
    }

    private static void StaleBytes()
    {
        string file = MakeFile("stale.json", Before);
        using var lease = Open(file);
        // Normal external edits remain possible during review.
        File.WriteAllBytes(file, After);
        Assert(Commit(lease, Encoding.UTF8.GetBytes("different")) == TargetCode.Stale, "stale-bytes");
        Assert(File.ReadAllBytes(file).SequenceEqual(After), "stale-zero-mutation");
    }

    private static void Replacement()
    {
        string file = MakeFile("replace.json", Before), old = Path.Combine(Root, "replace-old.json");
        using var lease = Open(file);
        try { File.Move(file, old); Files.Add(old); }
        catch (IOException) { throw new FixtureFailure("replacement-move-sharing"); }
        try { MakeFile("replace.json", Before); }
        catch (IOException) { throw new FixtureFailure("replacement-create-sharing"); }
        Assert(Commit(lease, After) == TargetCode.Stale, "stale-identity");
        Assert(File.ReadAllBytes(file).SequenceEqual(Before) && File.ReadAllBytes(old).SequenceEqual(Before), "replacement-untouched");
    }

    private static void ExistingWriter()
    {
        string file = MakeFile("writer.json", Before);
        using var lease = Open(file);
        using var child = StartPeer("hold-writer", file);
        try
        {
            var ready = child.StandardOutput.ReadLineAsync();
            Assert(ready.Wait(TimeSpan.FromSeconds(5)), "writer-ready-deadline");
            Assert(ready.Result == "ready", "writer-ready");
            Assert(Commit(lease, After) == TargetCode.Refused, "open-writer-refused");
            using var witness = Native.Open(file, Native.Read, Native.ShareRead | Native.ShareWrite | Native.ShareDelete, false);
            Assert(Native.ReadExact(witness, Before.Length).SequenceEqual(Before), "writer-zero-mutation");
        }
        finally
        {
            if (!child.HasExited) { child.StandardInput.WriteLine("release"); child.StandardInput.Close(); }
            if (!child.WaitForExit(5000)) { child.Kill(true); child.WaitForExit(); }
        }
        Assert(child.ExitCode == 0, "writer-peer-exit");
    }

    private static void GuardExclusion()
    {
        string file = MakeFile("guard.json", Before);
        using var lease = Open(file);
        lease.GuardHeldForTest = () => {
            foreach (string operation in new[] { "try-write", "try-delete" })
            {
                using var child = StartPeer(operation, file);
                try
                {
                    Assert(child.WaitForExit(5000), "guard-peer-deadline");
                    Assert(child.ExitCode == 0 && child.StandardOutput.ReadToEnd().Trim() == "refused", "guard-peer-refused");
                }
                finally { if (!child.HasExited) { child.Kill(true); child.WaitForExit(); } }
            }
        };
        Assert(Commit(lease, After) == TargetCode.Written, "guarded-write");
    }

    private static void ParentPinned()
    {
        string folder = Path.Combine(Root, "parent"); Directory.CreateDirectory(folder); Directories.Add(folder);
        string file = MakeFile("parent\\config.json", Before);
        using var lease = Open(file);
        bool refused = false;
        try { Directory.Move(folder, folder + "-moved"); }
        catch (IOException) { refused = true; }
        Assert(refused, "parent-rename-refused");
        Assert(Commit(lease, After) == TargetCode.Written, "pinned-parent-write");
    }

    private static void Invalid()
    {
        foreach (string invalid in new[] { "relative", @"\\server\share\file", @"\\?\X:\file", @"X:\a\..\b", @"X:\NUL", @"X:\file:stream", @"X:\trailing. ", @"X:\a~1\b" })
            Assert(TargetLease.Begin(invalid, out _) == TargetCode.InvalidInput, "invalid-path");
        string file = MakeFile("too-large.json", new byte[TargetLease.MaxBytes + 1]);
        Assert(TargetLease.Begin(file, out _) == TargetCode.Refused, "oversize-read");
        string ordinary = MakeFile("invalid-after.json", Before);
        using var lease = Open(ordinary);
        Assert(Commit(lease, new byte[TargetLease.MaxBytes + 1]) == TargetCode.InvalidInput, "oversize-write");
        Assert(lease.CompareAndWrite("incorrect", Before, After) == TargetCode.InvalidInput, "wrong-token");
        Assert(lease.CompareAndWrite(lease.Identity, After, After) == TargetCode.InvalidInput, "wrong-expected-bytes");
        Assert(File.ReadAllBytes(ordinary).SequenceEqual(Before), "invalid-zero-mutation");
        Assert(TargetLease.Begin(Root, out _) == TargetCode.Refused, "directory-refused");
        Assert(TargetLease.Begin(Path.Combine(Root, "missing.json"), out _) == TargetCode.Refused, "missing-refused");
        Assert(!File.Exists(Path.Combine(Root, "missing.json")), "missing-not-created");
        string readOnly = MakeFile("read-only.json", Before);
        File.SetAttributes(readOnly, FileAttributes.ReadOnly);
        try { Assert(TargetLease.Begin(readOnly, out _) == TargetCode.Refused, "readonly-refused"); }
        finally { File.SetAttributes(readOnly, FileAttributes.Normal); }
    }

    private static void Hardlink()
    {
        string file = MakeFile("hardlink-source.json", Before), link = Path.Combine(Root, "hardlink.json");
        Assert(CreateHardLinkW(link, file, 0), "create-owned-hardlink"); Files.Add(link);
        Assert(TargetLease.Begin(file, out _) == TargetCode.Refused, "hardlink-source-refused");
        Assert(TargetLease.Begin(link, out _) == TargetCode.Refused, "hardlink-alias-refused");
        string later = MakeFile("hardlink-later-source.json", Before), laterLink = Path.Combine(Root, "hardlink-later.json");
        using var lease = Open(later);
        Assert(CreateHardLinkW(laterLink, later, 0), "create-hardlink-during-review"); Files.Add(laterLink);
        Assert(Commit(lease, After) == TargetCode.Refused, "new-hardlink-refused-at-commit");
        Assert(File.ReadAllBytes(later).SequenceEqual(Before), "new-hardlink-zero-mutation");
    }

    private static void Symlink()
    {
        string file = MakeFile("symlink-source.json", Before), link = Path.Combine(Root, "symlink.json");
        try { File.CreateSymbolicLink(link, file); Files.Add(link); }
        catch (UnauthorizedAccessException) { Results.Add(new { name = "symlink-creation", status = "pass", qualification = "not-run-no-privilege" }); return; }
        Assert(TargetLease.Begin(link, out _) == TargetCode.Refused, "symlink-refused");
        string folder = Path.Combine(Root, "symlink-parent-source"), folderLink = Path.Combine(Root, "symlink-parent");
        Directory.CreateDirectory(folder); Directories.Add(folder);
        MakeFile("symlink-parent-source\\config.json", Before);
        Directory.CreateSymbolicLink(folderLink, folder); Directories.Add(folderLink);
        Assert(TargetLease.Begin(Path.Combine(folderLink, "config.json"), out _) == TargetCode.Refused, "symlink-parent-refused");
    }

    private static void PostwriteFault()
    {
        string file = MakeFile("fault.json", Before);
        using var lease = Open(file);
        lease.AfterWriteForTest = _ => throw new FixtureFailure("injected-native-boundary-fault");
        Assert(Commit(lease, After) == TargetCode.RetainedUnknown, "postwrite-unknown");
        Assert(File.ReadAllBytes(file).SequenceEqual(After), "fault-really-after-write");
        Assert(lease.CompareAndWrite(lease.Identity, Before, Before) == TargetCode.RetainedUnknown, "unknown-sticky-no-rollback");
    }

    private static void ReadbackFault()
    {
        string file = MakeFile("readback.json", Before);
        using var lease = Open(file);
        lease.AfterWriteForTest = handle => {
            // Actual corruption through the owned native transaction handle,
            // followed by the production flush/readback path (no mocked result).
            RandomAccess.Write(handle, new byte[] { 0x7F }, 0);
        };
        Assert(Commit(lease, After) == TargetCode.RetainedUnknown, "readback-mismatch-unknown");
        Assert(File.ReadAllBytes(file)[0] == 0x7F, "readback-corruption-really-applied");
    }

    private static void Disposal()
    {
        string file = MakeFile("dispose.json", Before);
        int beforeCount = Process.GetCurrentProcess().HandleCount;
        for (int i = 0; i < 48; i++) { using var lease = Open(file); lease.Dispose(); lease.Dispose(); }
        int afterCount = Process.GetCurrentProcess().HandleCount;
        Assert(afterCount <= beforeCount + 4, "bounded-handle-growth");
        using (var handle = File.OpenHandle(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Assert(!handle.IsInvalid, "no-retained-target-handle");
        string moved = Root + "-disposed";
        Directory.Move(Root, moved); Directory.Move(moved, Root);
    }
}
