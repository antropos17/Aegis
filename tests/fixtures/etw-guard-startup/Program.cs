using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class Program
{
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(3);
    private static string checkpoint = "start";
    private static TaskCompletionSource<T> Signal<T>() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static void Require(bool value) { if (!value) throw new InvalidOperationException("Fixture assertion failed."); }
    private static async Task<T> Error<T>(Task task) where T : Exception
    {
        try { await task.WaitAsync(Budget); }
        catch (T error) { return error; }
        throw new InvalidOperationException("Expected fixture exception.");
    }

    internal static ProcessStartInfo Child(params string[] ignored)
    {
        var info = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false };
        if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase))
            info.ArgumentList.Add(typeof(Program).Assembly.Location);
        info.ArgumentList.Add("--guard-child");
        return info;
    }

    private static async Task<int> Main(string[] args)
    {
        if (args.SequenceEqual(["--guard-child"])) return 3;
        (string Name, Func<Task> Run)[] cases =
        [
            ("exit-before-connect", () => BeforeConnect(72)),
            ("zero-exit-before-connect", () => BeforeConnect(0)),
            ("exit-during-connect-cancels-io", DuringConnect),
            ("exit-during-broker-ack-releases-read", () => DuringRead("broker")),
            ("exit-during-reserve-ack-releases-read", () => DuringRead("reserve")),
            ("delayed-valid-success", DelayedSuccess),
            ("shared-deadline-expires", SharedDeadline),
            ("completed-operation-cannot-hide-exit", CompletedOperationExit),
            ("late-completion-cannot-revive", () => LateCompletion(false)),
            ("late-fault-cannot-revive", () => LateCompletion(true)),
            ("canceled-watcher-is-not-peer-exit", CanceledWatcher),
            ("dispose-cancels-pending-io", DisposeCancellation),
            ("actual-owner-exit-three-before-connect", OwnerExit),
            ("actual-diagnostic-closed-peer-exit", Diagnostic)
        ];
        int passed = 0;
        foreach (var test in cases)
        {
            checkpoint = "start";
            try { await test.Run().WaitAsync(TimeSpan.FromSeconds(6)); passed++; }
            catch (Exception error)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new { test = test.Name, checkpoint, error = error.GetType().Name }));
                return 1;
            }
        }
        Console.WriteLine(JsonSerializer.Serialize(new { schema = "aegis-guard-startup-fixture/1", passed, failed = 0,
            cases = cases.Select(test => test.Name).ToArray(), etw = false, elevated = false }));
        return 0;
    }

    private static async Task BeforeConnect(int exitCode)
    {
        using var deadline = new CancellationTokenSource(Budget);
        using var startup = new FileGuardStartup(Task.CompletedTask, () => exitCode, deadline.Token);
        using var pipe = Security.Server(Guid.NewGuid().ToString("N"));
        bool invoked = false;
        var error = await Error<FileGuardPeerExitedException>(startup.Wait(token =>
        { invoked = true; return pipe.WaitForConnectionAsync(token); }));
        Require(error.ExitCode == exitCode && !invoked);
    }

    private static async Task DuringConnect()
    {
        using var deadline = new CancellationTokenSource(Budget);
        var exit = Signal<bool>();
        using var startup = new FileGuardStartup(exit.Task, () => 3, deadline.Token);
        using var pipe = Security.Server(Guid.NewGuid().ToString("N"));
        Task? pending = null;
        Task wait = startup.Wait(token => pending = pipe.WaitForConnectionAsync(token));
        Require(pending != null && !pending.IsCompleted);
        exit.SetResult(true);
        Require((await Error<FileGuardPeerExitedException>(wait)).ExitCode == 3);
        await Error<OperationCanceledException>(pending!);
    }

    private static async Task DuringRead(string stage)
    {
        using var deadline = new CancellationTokenSource(Budget);
        string name = Guid.NewGuid().ToString("N");
        using var server = Security.Server(name);
        using var client = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous);
        await Task.WhenAll(server.WaitForConnectionAsync(deadline.Token), client.ConnectAsync(deadline.Token));
        var exit = Signal<bool>();
        using var startup = new FileGuardStartup(exit.Task, () => 3, deadline.Token);
        Task<int>? pending = null;
        Task<int> wait = startup.Wait(token => pending = server.ReadAsync(new byte[1], token).AsTask());
        Require(stage is "broker" or "reserve" && pending != null && !pending.IsCompleted);
        exit.SetResult(true);
        checkpoint = "peer-exception";
        Require((await Error<FileGuardPeerExitedException>(wait)).ExitCode == 3);
        checkpoint = "read-cancellation";
        await Error<OperationCanceledException>(pending!);
        byte[] later = new byte[1];
        checkpoint = "later-read";
        var read = server.ReadAsync(later, deadline.Token).AsTask();
        checkpoint = "later-write";
        await client.WriteAsync(new byte[] { 42 }, deadline.Token);
        Require(await read == 1 && later[0] == 42);
    }

    private static async Task DelayedSuccess()
    {
        using var deadline = new CancellationTokenSource(Budget);
        var exit = Signal<bool>(); var first = Signal<int>(); var second = Signal<int>();
        using var startup = new FileGuardStartup(exit.Task, () => 3, deadline.Token);
        var one = startup.Wait(_ => first.Task); Require(!one.IsCompleted); first.SetResult(23);
        Require(await one == 23);
        var two = startup.Wait(_ => second.Task); Require(!two.IsCompleted); second.SetResult(42);
        Require(await two == 42);
    }

    private static async Task SharedDeadline()
    {
        using var deadline = new CancellationTokenSource(Budget);
        var exit = Signal<bool>(); var observed = Signal<bool>(); var late = Signal<int>();
        using var startup = new FileGuardStartup(exit.Task, () => 3, deadline.Token);
        Require(await startup.Wait(_ => Task.FromResult(23)) == 23);
        Task wait = startup.Wait(token => { token.Register(() => observed.TrySetResult(true)); return late.Task; });
        deadline.CancelAfter(TimeSpan.FromMilliseconds(30));
        await Error<OperationCanceledException>(wait);
        await observed.Task.WaitAsync(Budget);
        late.SetResult(42);
        bool invoked = false;
        await Error<OperationCanceledException>(startup.Wait(_ => { invoked = true; return Task.CompletedTask; }));
        Require(!invoked);
    }

    private static async Task CompletedOperationExit()
    {
        using var deadline = new CancellationTokenSource(Budget);
        var exit = Signal<bool>();
        using var startup = new FileGuardStartup(exit.Task, () => 3, deadline.Token);
        await Error<FileGuardPeerExitedException>(startup.Wait(_ => { exit.SetResult(true); return Task.FromResult(42); }));
    }

    private static async Task LateCompletion(bool fault)
    {
        using var deadline = new CancellationTokenSource(Budget);
        var exit = Signal<bool>(); var late = Signal<int>();
        using var startup = new FileGuardStartup(exit.Task, () => 3, deadline.Token);
        Task wait = startup.Wait(_ => late.Task); exit.SetResult(true);
        await Error<FileGuardPeerExitedException>(wait);
        if (fault) late.SetException(new IOException()); else late.SetResult(42);
        bool invoked = false;
        await Error<FileGuardPeerExitedException>(startup.Wait(_ => { invoked = true; return Task.CompletedTask; }));
        Require(!invoked && wait.IsFaulted);
    }

    private static async Task CanceledWatcher()
    {
        using var deadline = new CancellationTokenSource(Budget);
        var exit = Signal<bool>(); var result = Signal<int>();
        using var startup = new FileGuardStartup(exit.Task, () => throw new InvalidOperationException(), deadline.Token);
        Task<int> wait = startup.Wait(_ => result.Task); exit.SetCanceled(); result.SetResult(42);
        Require(await wait == 42);
    }

    private static async Task DisposeCancellation()
    {
        using var deadline = new CancellationTokenSource(Budget);
        var exit = Signal<bool>();
        using var startup = new FileGuardStartup(exit.Task, () => 3, deadline.Token);
        using var pipe = Security.Server(Guid.NewGuid().ToString("N"));
        Task wait = startup.Wait(token => pipe.WaitForConnectionAsync(token));
        startup.Dispose();
        await Error<OperationCanceledException>(wait);
        exit.SetCanceled();
    }

    private static async Task OwnerExit()
    {
        using var broker = Process.GetCurrentProcess(); using var data = new MemoryStream();
        var error = await Error<FileGuardPeerExitedException>(
            FileGuardOwner.Start("fixture", broker, 1, data, "fixture", "fixture"));
        Require(error.ExitCode == 3 && data.Length == 0);
    }

    private static async Task Diagnostic()
    {
        string? old = Environment.GetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable);
        try
        {
            Environment.SetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable, "1");
            FileQualificationDiagnostic.Step = 0;
            FileQualificationDiagnostic.BeginCollector();
            foreach (string phase in FileQualificationDiagnostic.StartupStages)
            {
                FileQualificationDiagnostic.Stage(phase); using var writer = new StringWriter();
                FileQualificationDiagnostic.Report(new FileGuardPeerExitedException(3), writer);
                var value = await FileQualificationDiagnostic.Drain(new StringReader(writer.ToString()));
                Require(value == new FileCollectorDiagnostic(phase, "peer-exit", 3));
            }
            string[] rejected =
            [
                "{\"stage\":\"running\",\"kind\":\"peer-exit\",\"code\":3}",
                "{\"stage\":\"guard-connect\",\"kind\":\"peer-exit\",\"code\":3,\"path\":\"private\"}",
                "{\"stage\":\"guard-connect\",\"kind\":\"peer-exit\",\"code\":\"private\"}",
                new string('x', 257)
            ];
            foreach (string invalid in rejected)
                Require(await FileQualificationDiagnostic.Drain(new StringReader(invalid)) == null);
        }
        finally
        {
            Environment.SetEnvironmentVariable(FileQualificationDiagnostic.CollectorVariable, old);
            FileQualificationDiagnostic.BeginCollector();
        }
    }
}
