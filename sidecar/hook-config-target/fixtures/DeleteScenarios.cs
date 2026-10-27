using System.Text;
using static Aegis.HookConfigTarget.Fixtures.Program;

namespace Aegis.HookConfigTarget.Fixtures;

internal static class DeleteScenarios
{
    internal static void Run()
    {
        Scenario("delete-approved-original", Approved);
        Scenario("delete-replacement-blocked-during-review", Replacement);
        Scenario("delete-dispose-preserves-file", Cancel);
        Scenario("delete-existing-writer-refused", ExistingWriter);
        Scenario("delete-existing-reader-pending-unknown", ExistingReader);
    }

    private static DeleteLease Open(string path)
    {
        Assert(DeleteLease.Begin(path, out var lease) == DeleteCode.Ready && lease is not null, "delete-begin-ready");
        return lease!;
    }

    private static void Approved()
    {
        string file = MakeFile("delete-approved.txt", Encoding.UTF8.GetBytes("original"));
        using var lease = Open(file);
        Assert(lease.Delete() == DeleteCode.Deleted, "delete-confirmed");
        Assert(!File.Exists(file), "deleted-file-absent");
        Assert(lease.Delete() == DeleteCode.Closed, "delete-single-attempt");
    }

    private static void Replacement()
    {
        string file = MakeFile("delete-reviewed.txt", Encoding.UTF8.GetBytes("reviewed"));
        string replacement = MakeFile("delete-replacement.txt", Encoding.UTF8.GetBytes("replacement"));
        using var lease = Open(file);
        using var child = StartPeer("try-replace", file);
        try
        {
            Assert(child.WaitForExit(5000), "replacement-peer-deadline");
            Assert(child.ExitCode == 0 && child.StandardOutput.ReadToEnd().Trim() == "refused", "replacement-refused");
        }
        finally { if (!child.HasExited) { child.Kill(true); child.WaitForExit(); } }
        using (var read = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var text = new StreamReader(read))
            Assert(text.ReadToEnd() == "reviewed", "reviewed-still-selected");
        Assert(lease.Delete() == DeleteCode.Deleted, "reviewed-deleted");
        Assert(File.ReadAllText(replacement) == "replacement", "replacement-preserved");
    }

    private static void Cancel()
    {
        string file = MakeFile("delete-cancel.txt", Encoding.UTF8.GetBytes("untouched"));
        using (var lease = Open(file)) { }
        Assert(File.ReadAllText(file) == "untouched", "cancel-preserves-original");
        using var write = File.OpenHandle(file, FileMode.Open, FileAccess.Write, FileShare.None);
    }

    private static void ExistingWriter()
    {
        string file = MakeFile("delete-writer.txt", Encoding.UTF8.GetBytes("writer"));
        using var writer = File.OpenHandle(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
        Assert(DeleteLease.Begin(file, out var lease) == DeleteCode.Refused && lease is null, "existing-writer-refused");
    }

    private static void ExistingReader()
    {
        string file = MakeFile("delete-reader.txt", Encoding.UTF8.GetBytes("reader"));
        using var reader = File.OpenHandle(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var lease = Open(file);
        Assert(lease.Delete() == DeleteCode.Unknown, "pending-delete-unknown");
    }
}
