using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using Aegis.HookConfigTarget;

namespace Aegis.HookConfigTarget.Fixtures;

internal static class Program
{
    internal static readonly List<string> Files = [], Directories = [];
    internal static readonly List<object> Results = [];
    internal static string Root = "";

    private static bool ValidRoot(string root) => TargetPath.IsValid(root) &&
        root.StartsWith(@"X:\tmp\", StringComparison.Ordinal) &&
        Regex.IsMatch(Path.GetFileName(root), @"^hook-config-target-fixture-[a-z0-9-]+$");

    internal static void Assert(bool value, string assertion)
    {
        if (!value) throw new FixtureFailure(assertion);
    }

    internal static string MakeFile(string name, byte[] bytes)
    {
        string path = Path.Combine(Root, name);
        using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            stream.Write(bytes);
        Files.Add(path);
        return path;
    }

    internal static TargetLease Open(string path)
    {
        Assert(TargetLease.Begin(path, out var lease) == TargetCode.Ready && lease is not null, "begin-ready");
        return lease!;
    }

    internal static void Scenario(string name, Action test)
    {
        try { test(); Results.Add(new { name, status = "pass" }); }
        catch (FixtureFailure failure) { Results.Add(new { name, status = "fail", assertion = failure.Message }); }
        catch (Exception failure) { Results.Add(new { name, status = "fail", assertion = "unexpected-fixture-error",
            exception = failure.GetType().Name, hresult = failure.HResult }); }
    }

    private static void ValidateAncestors(string path)
    {
        for (string? part = Path.GetPathRoot(path); part is not null && part.Length <= path.Length;)
        {
            Assert(Directory.Exists(part), "owned-ancestor-missing");
            Assert((File.GetAttributes(part) & FileAttributes.ReparsePoint) == 0, "owned-ancestor-reparse");
            int next = path.IndexOf('\\', part.Length);
            if (next < 0) break;
            part = path[..(next + 1)];
        }
    }

    // Never follow links or enumerate-and-delete recursively. Only exact registered
    // files/directories created by this process are eligible; locked entries remain.
    private static object Cleanup()
    {
        int removed = 0, retained = 0;
        foreach (string path in Files.AsEnumerable().Reverse())
        {
            try
            {
                ValidateAncestors(path);
                if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { retained++; continue; }
                File.Delete(path); removed++;
            }
            catch (FileNotFoundException) { }
            catch { retained++; }
        }
        foreach (string path in Directories.AsEnumerable().Reverse().Append(Root))
        {
            try
            {
                ValidateAncestors(path + "\\placeholder");
                if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { retained++; continue; }
                Directory.Delete(path, false); removed++;
            }
            catch { retained++; }
        }
        return new { removed, retained, policy = "retained-for-review-after-seven-days-no-automatic-deletion" };
    }

    public static int Main(string[] args)
    {
        if (args.Length == 4 && args[0] == "--peer") return Peer(args[1], args[2], args[3]);
        if (args.Length != 1 || !OperatingSystem.IsWindows() || !ValidRoot(args[0]))
        { Console.WriteLine("{\"status\":\"invalid-fixture-root\"}"); return 2; }
        Root = args[0];
        try
        {
            ValidateAncestors(Root);
            Assert(!Directory.Exists(Root) && !File.Exists(Root), "fixture-root-must-be-new");
            Directory.CreateDirectory(Root);
            Scenarios.Run();
            var cleanup = Cleanup();
            bool passed = Results.All(item => JsonSerializer.Serialize(item).Contains("\"status\":\"pass\""));
            Console.WriteLine(JsonSerializer.Serialize(new { status = passed ? "pass" : "fail",
                os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.OSArchitecture.ToString(),
                runtime = Environment.Version.ToString(), scenarios = Results, cleanup }));
            return passed ? 0 : 1;
        }
        catch { Console.WriteLine("{\"status\":\"fixture-preflight-failed\"}"); return 2; }
    }

    internal static Process StartPeer(string mode, string path)
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false,
            RedirectStandardOutput = true, RedirectStandardInput = true, RedirectStandardError = true,
            CreateNoWindow = true };
        start.ArgumentList.Add("--peer"); start.ArgumentList.Add(mode);
        start.ArgumentList.Add(Root); start.ArgumentList.Add(path);
        return Process.Start(start) ?? throw new FixtureFailure("peer-start");
    }

    private static int Peer(string mode, string root, string path)
    {
        if (!ValidRoot(root) || !path.StartsWith(root + "\\", StringComparison.Ordinal) ||
            !TargetPath.IsValid(path)) return 2;
        try
        {
            if (mode == "hold-writer")
            {
                using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.ReadWrite,
                    FileShare.ReadWrite | FileShare.Delete);
                Console.WriteLine("ready"); Console.Out.Flush();
                // Owned inert peer exits on release/EOF; parent timeout is bounded.
                Console.ReadLine();
                return 0;
            }
            if (mode is "try-write" or "try-delete" or "try-replace")
            {
                try
                {
                    if (mode == "try-write")
                    {
                        using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.Write,
                            FileShare.ReadWrite | FileShare.Delete);
                        Console.WriteLine("unexpected-open");
                    }
                    else if (mode == "try-replace") { File.Move(Path.Combine(root, "delete-replacement.txt"), path, true); Console.WriteLine("unexpected-replace"); }
                    else { File.Delete(path); Console.WriteLine("unexpected-delete"); }
                    return 1;
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                { Console.WriteLine("refused"); return 0; }
            }
            return 2;
        }
        catch { return 2; }
    }
}

internal sealed class FixtureFailure(string code) : Exception(code);
