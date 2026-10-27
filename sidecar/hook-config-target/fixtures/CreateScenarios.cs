using System.Text;
using static Aegis.HookConfigTarget.Fixtures.Program;

namespace Aegis.HookConfigTarget.Fixtures;

internal static class CreateScenarios
{
    private static readonly byte[] Policy = Encoding.UTF8.GetBytes("{\"schemaVersion\":2}\n");

    internal static void Run()
    {
        Scenario("create-cancel-is-empty", Cancel);
        Scenario("create-exact-held-file-and-scope", Create);
        Scenario("create-existing-collision-untouched", Collision);
        Scenario("create-destination-parent-pinned", DestinationPinned);
        Scenario("create-scope-parent-pinned", ScopePinned);
        Scenario("create-reparse-scope-refused-when-permitted", ReparseScope);
        Scenario("create-after-write-failure-retained-unknown", Unknown);
    }

    private static CreateLease Open(string target, string scope)
    {
        Assert(CreateLease.Begin(target, scope, out var lease) == TargetCode.Ready && lease is not null,
            "create-begin-ready");
        return lease!;
    }

    private static void Cancel()
    {
        string path = Path.Combine(Root, "cancel-policy.json");
        using (var lease = Open(path, Root)) Assert(!File.Exists(path), "begin-does-not-create");
        Assert(!File.Exists(path), "cancel-does-not-create");
    }

    private static void Create()
    {
        string path = Path.Combine(Root, "new-policy.json"); Files.Add(path);
        using var lease = Open(path, Root);
        Assert(lease.Create(Policy) == TargetCode.Written, "create-written");
        Assert(lease.Check() == TargetCode.Ready, "create-readback-and-identity");
        using (var reader = Native.Open(path, Native.Read,
            Native.ShareRead | Native.ShareWrite | Native.ShareDelete, false))
        {
            var state = Native.Inspect(reader, path, false);
            Assert(Native.ReadExact(reader, state.State.Length).SequenceEqual(Policy), "create-exact-bytes");
        }
        bool writeRefused = false, deleteRefused = false;
        try { using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete); }
        catch (IOException) { writeRefused = true; }
        try { File.Delete(path); } catch (IOException) { deleteRefused = true; }
        Assert(writeRefused && deleteRefused, "created-file-excludes-write-delete");
        Assert(lease.Create(Policy) == TargetCode.Closed, "create-once");
        Assert(lease.Check() == TargetCode.Ready, "held-check-after-refused-peers");
    }

    private static void Collision()
    {
        string path = Path.Combine(Root, "collision-policy.json");
        using var lease = Open(path, Root);
        MakeFile("collision-policy.json", [1, 2, 3]);
        Assert(lease.Create(Policy) == TargetCode.Refused, "collision-refused");
        Assert(File.ReadAllBytes(path).SequenceEqual(new byte[] { 1, 2, 3 }), "collision-untouched");
        Assert(lease.Check() == TargetCode.Closed, "collision-never-adopted");
    }

    private static void DestinationPinned()
    {
        string parent = Path.Combine(Root, "destination-parent");
        Directory.CreateDirectory(parent); Directories.Add(parent);
        string path = Path.Combine(parent, "policy.json"); Files.Add(path);
        using var lease = Open(path, Root);
        bool refused = false;
        try { Directory.Move(parent, parent + "-moved"); } catch (IOException) { refused = true; }
        Assert(refused, "destination-rename-refused");
        Assert(lease.Create(Policy) == TargetCode.Written && lease.Check() == TargetCode.Ready,
            "destination-create-valid");
    }

    private static void ScopePinned()
    {
        string scope = Path.Combine(Root, "selected-scope");
        Directory.CreateDirectory(scope); Directories.Add(scope);
        string path = Path.Combine(Root, "scope-policy.json"); Files.Add(path);
        using var lease = Open(path, scope);
        bool refused = false;
        try { Directory.Move(scope, scope + "-moved"); } catch (IOException) { refused = true; }
        Assert(refused, "scope-rename-refused");
        Assert(lease.Create(Policy) == TargetCode.Written && lease.Check() == TargetCode.Ready, "scope-create-valid");
    }

    private static void ReparseScope()
    {
        string folder = Path.Combine(Root, "scope-real"), link = Path.Combine(Root, "scope-link");
        Directory.CreateDirectory(folder); Directories.Add(folder);
        try { Directory.CreateSymbolicLink(link, folder); Directories.Add(link); }
        catch (UnauthorizedAccessException) { return; }
        string path = Path.Combine(Root, "reparse-policy.json");
        Assert(CreateLease.Begin(path, link, out _) == TargetCode.Refused, "reparse-scope-refused");
        Assert(!File.Exists(path), "reparse-scope-no-create");
    }

    private static void Unknown()
    {
        string path = Path.Combine(Root, "unknown-policy.json"); Files.Add(path);
        using var lease = Open(path, Root);
        lease.AfterWriteForTest = _ => throw new FixtureFailure("post-create-fault");
        Assert(lease.Create(Policy) == TargetCode.RetainedUnknown, "post-create-unknown");
        Assert(lease.Check() == TargetCode.Closed, "unknown-never-adopted");
        Assert(File.Exists(path), "unknown-not-deleted");
    }
}
