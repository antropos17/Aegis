namespace Aegis.EtwLifecycle;

internal static class FileQualificationTests
{
    internal static void Run(Action<string, Action> test)
    {
        string id = "12345678123456781234567812345678";
        string[] capture = ["collector", id, id, id, "71", "1000", @"C:\lab\case\fixture", FileWire.Profile, id, id, "orphan-custody"];
        void Validate(string[] args) => FileQualificationPolicy.Validate(args, @"C:\lab", 71, 1000);
        test("qualification launch authority rejects arbitrary commands, roots and identity substitution", () =>
        {
            Validate(capture); Validate(["recover-peer", id, "71", "1000"]);
            foreach (int index in new[] { 0, 3, 4, 5, 6, 7, 10 })
            {
                var value = (string[])capture.Clone(); value[index] = index == 6 ? @"C:\laboratory\outside" : "foreign";
                Reject(() => Validate(value));
            }
            Reject(() => Validate(["cmd.exe", "/c", "anything"]));
            Reject(() => Validate(["recover-peer", id, "72", "1000"]));
            Reject(() => Validate(capture[..10]));
            var traversal = (string[])capture.Clone(); traversal[6] = @"C:\lab\..\outside";
            Reject(() => Validate(traversal));
        });
        test("qualification host permits only the existing bounded collector modes", () =>
        {
            foreach (string mode in new[] { "orphan-main-collector", "custodian-exit-collector", "triple-prestart-collector" })
            { var value = (string[])capture.Clone(); value[0] = mode; Validate(value); }
            foreach (string mode in new[] { "custodian", "rescue", "inspect-elevated", "self-test", "check-collector" })
            { var value = (string[])capture.Clone(); value[0] = mode; Reject(() => Validate(value)); }
        });
        test("qualification witness survives delayed reader until explicit acceptance before disconnect", () =>
        {
            static async Task Transfer()
            {
                string pipeId = Guid.NewGuid().ToString("N");
                using var server = Security.Server(pipeId);
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                var client = Task.Run(async () =>
                {
                    using var pipe = Security.Client(pipeId);
                    await Task.Delay(100, deadline.Token); // Force unread bytes at the old Disconnect.
                    var witness = await FileGuardWire.Read<FileMainWitness>(pipe, deadline.Token);
                    if (witness != new FileMainWitness(71, "1000", "10")) throw new InvalidDataException();
                    await FileGuardWire.Write(pipe, new FileGuardCommand("accepted"), deadline.Token);
                });
                await server.WaitForConnectionAsync(deadline.Token);
                await FileQualificationHost.Offer(server, new(71, "1000", "10"), deadline.Token);
                server.Disconnect();
                await client;
            }
            Transfer().GetAwaiter().GetResult();
        });
        test("accepted qualification startup preserves the existing generic capture failure exit", () =>
        {
            string? original = Environment.GetEnvironmentVariable(FileQualificationPolicy.Variable);
            try
            {
                Environment.SetEnvironmentVariable(FileQualificationPolicy.Variable, "test-only");
                FileQualificationDiagnostic.Step = 3;
                if (FileQualificationDiagnostic.Failure != 131) throw new InvalidOperationException();
                FileQualificationDiagnostic.Step = 6;
                if (FileQualificationDiagnostic.Failure != 2) throw new InvalidOperationException();
            }
            finally { FileQualificationDiagnostic.Step = 0; Environment.SetEnvironmentVariable(FileQualificationPolicy.Variable, original); }
        });
        test("collector failure diagnostics require explicit collector initialization and never retain exception text", () =>
        {
            string? original = Environment.GetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable);
            try
            {
                Environment.SetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable, null);
                FileQualificationDiagnostic.BeginCollector();
                using var disabled = new StringWriter();
                FileQualificationDiagnostic.Report(new IOException("private-path"), disabled);
                if (disabled.ToString() != "") throw new InvalidOperationException();
                Environment.SetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable, "1");
                // A launch marker alone cannot make another role emit collector diagnostics.
                FileQualificationDiagnostic.Report(new IOException("private-path"), disabled);
                if (disabled.ToString() != "") throw new InvalidOperationException();
                var child = Program.Child("guard");
                if (child.Environment.ContainsKey(FileQualificationDiagnostic.CollectorVariable)) throw new InvalidOperationException();
                FileQualificationDiagnostic.BeginCollector(); FileQualificationDiagnostic.Stage("trace-start");
                using var output = new StringWriter();
                FileQualificationDiagnostic.Report(new System.ComponentModel.Win32Exception(5, "private-path"), output);
                var parsed = FileQualificationDiagnostic.Drain(new StringReader(output.ToString())).GetAwaiter().GetResult();
                if (parsed != new FileCollectorDiagnostic("trace-start", "win32", 5) || output.ToString().Contains("private-path"))
                    throw new InvalidOperationException();
                FileQualificationDiagnostic.Step = 6;
                if (FileQualificationDiagnostic.Failure != 2) throw new InvalidOperationException();
            }
            finally
            {
                Environment.SetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable, original);
                FileQualificationDiagnostic.Step = 0;
                // Do not leave collector emission enabled in the self-test process.
                Environment.SetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable, null);
                FileQualificationDiagnostic.BeginCollector();
                Environment.SetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable, original);
            }
        });
        test("collector stderr drain rejects overflow, extra records, duplicate keys and nonfinite diagnostic shapes", () =>
        {
            const string valid = "{\"stage\":\"guard\",\"kind\":\"hresult\",\"code\":-2147467259}";
            if (FileQualificationDiagnostic.Drain(new StringReader(valid)).GetAwaiter().GetResult() == null) throw new InvalidOperationException();
            foreach (string invalid in new[] { new string('x', 1024), valid + "\n" + valid,
                "{\"stage\":\"guard\",\"stage\":\"stop\",\"kind\":\"win32\",\"code\":5}",
                valid.Replace("guard", "private-path"), valid.Replace("hresult", "exception"),
                valid.Replace("-2147467259", "2147483648"), valid.Replace("}", ",\"message\":\"secret\"}"),
                "null", "[]", "{}" })
                if (FileQualificationDiagnostic.Drain(new StringReader(invalid)).GetAwaiter().GetResult() != null)
                    throw new InvalidOperationException();
        });
        test("maximum bounded qualification finish diagnostics fit the existing private wire", () =>
        {
            var diagnostics = new FileCollectorDiagnostic?[64];
            for (int i = 0; i < 4; i++) diagnostics[i] = new("capture-start", "hresult", int.MinValue);
            var finish = new FileQualificationFinished(64, 0, Enumerable.Repeat(int.MinValue, 64).ToArray(), diagnostics);
            byte[] bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(finish);
            if (bytes.Length > 2048) throw new InvalidOperationException();
        });
    }
    private static void Reject(Action action) { bool rejected = false; try { action(); } catch { rejected = true; } if (!rejected) throw new InvalidOperationException(); }
}
