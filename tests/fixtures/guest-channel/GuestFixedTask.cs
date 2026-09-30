using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

// Fixed trusted dummy corpus only. These host runtimes do not qualify a guest.
internal static class GuestFixedTask
{
    internal const string Before = "alpha\n";
    internal const string After = "beta\n";
    internal const string Test = "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\ntest('fixed edit', () => assert.equal(fs.readFileSync('source.txt', 'utf8'), 'beta\\n'));\n";
    internal static string Root(string image, string mode) { return Path.Combine(Path.GetDirectoryName(image), "project-" + mode); }
    private static string BoundedRead(StreamReader input)
    {
        char[] part = new char[128]; var text = new System.Text.StringBuilder();
        int count;
        while ((count = input.Read(part, 0, part.Length)) > 0)
        {
            BootstrapWire.Require(text.Length + count <= 4096, "task-output-limit");
            text.Append(part, 0, count);
        }
        return text.ToString();
    }
    private static string Run(string executable, string arguments, string root)
    {
        var info = new ProcessStartInfo(executable, arguments) {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        info.EnvironmentVariables.Clear();
        info.EnvironmentVariables["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot");
        info.EnvironmentVariables["SystemDrive"] = Path.GetPathRoot(Environment.GetEnvironmentVariable("SystemRoot")).TrimEnd('\\');
        info.EnvironmentVariables["TEMP"] = root; info.EnvironmentVariables["TMP"] = root;
        info.EnvironmentVariables["HOME"] = root; info.EnvironmentVariables["USERPROFILE"] = root;
        info.EnvironmentVariables["APPDATA"] = root; info.EnvironmentVariables["LOCALAPPDATA"] = root;
        info.EnvironmentVariables["GIT_CONFIG_NOSYSTEM"] = "1"; info.EnvironmentVariables["GIT_CONFIG_GLOBAL"] = "NUL";
        info.EnvironmentVariables["GIT_ATTR_NOSYSTEM"] = "1"; info.EnvironmentVariables["GIT_TERMINAL_PROMPT"] = "0";
        using (var process = Process.Start(info))
        {
            try
            {
                BootstrapWire.Require(process != null, "task-unavailable");
                process.StandardInput.Close();
                var output = Task.Factory.StartNew(() => BoundedRead(process.StandardOutput));
                var error = Task.Factory.StartNew(() => BoundedRead(process.StandardError));
                BootstrapWire.Require(process.WaitForExit(5000) && Task.WaitAll(new Task[] { output, error }, 1000), "task-timeout");
                BootstrapWire.Require(process.ExitCode == 0 && error.Result.Length == 0, "task-unavailable");
                return output.Result;
            }
            catch
            {
                try { if (process != null && !process.HasExited) process.Kill(); } catch { }
                // Only the owning outer Job can confirm complete descendant closure.
                throw;
            }
        }
    }
    internal static byte[] Execute(string image, string mode, string node, string git)
    {
        string root = Root(image, mode);
        BootstrapWire.Require(!Directory.Exists(root), "task-workspace-exists");
        Directory.CreateDirectory(root); Directory.CreateDirectory(Path.Combine(root, "empty"));
        File.WriteAllText(Path.Combine(root, "source.txt"), Before, BootstrapWire.Utf8);
        File.WriteAllText(Path.Combine(root, "fixture.test.cjs"), Test, BootstrapWire.Utf8);
        string config = "-c core.hooksPath=empty -c core.autocrlf=false -c core.abbrev=7 -c core.attributesFile=NUL -c core.fsmonitor=false -c core.untrackedCache=false -c commit.gpgsign=false -c protocol.allow=never ";
        BootstrapWire.Phase = "task-git-init";
        Run(git, config + "init --quiet --template=empty --initial-branch=fixture", root);
        BootstrapWire.Phase = "task-git-add";
        Run(git, config + "add -- source.txt fixture.test.cjs", root);
        BootstrapWire.Phase = "task-git-commit";
        Run(git, config + "-c user.name=AEGIS -c user.email=fixture@example.invalid commit --quiet --no-gpg-sign -m fixture", root);
        File.WriteAllText(Path.Combine(root, "source.txt"), After, BootstrapWire.Utf8);
        BootstrapWire.Phase = "task-node-test";
        string testOutput = Run(node, "--test --test-reporter=tap fixture.test.cjs", root);
        BootstrapWire.Require(testOutput.Contains("# pass 1") && testOutput.Contains("# fail 0"), "task-test-incomplete");
        BootstrapWire.Phase = "task-git-diff";
        string diff = Run(git, config + "diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ -- source.txt", root);
        BootstrapWire.Require(diff.Contains("-alpha\n+beta\n") && diff.Length < 2048, "task-diff-incomplete");
        string result = "{\"version\":1,\"sourceBeforeSha256\":\"" + BootstrapWire.Hash(BootstrapWire.Utf8.GetBytes(Before)) +
            "\",\"sourceAfterSha256\":\"" + BootstrapWire.HashFile(Path.Combine(root, "source.txt")) +
            "\",\"testSha256\":\"" + BootstrapWire.HashFile(Path.Combine(root, "fixture.test.cjs")) +
            "\",\"diffSha256\":\"" + BootstrapWire.Hash(BootstrapWire.Utf8.GetBytes(diff)) +
            "\",\"nodeTestPassed\":true,\"gitBaselineCreated\":true}";
        return BootstrapWire.Utf8.GetBytes(result);
    }
}
