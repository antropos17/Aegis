using System.Diagnostics;
using System.Text.Json;

namespace Aegis.EtwProbe;

// The elevated half accepts no workload commands. Only this normal-integrity
// coordinator executes the two fixed npm commands, using node's ArgumentList.
internal static class LoadStudy
{
    private static async Task Until(Func<bool> ready, Func<bool> failed, int seconds)
    {
        var timer = Stopwatch.StartNew();
        while (!ready())
        {
            if (failed()) throw new InvalidOperationException("Study peer failed");
            if (timer.Elapsed.TotalSeconds > seconds) throw new TimeoutException("Study peer timed out");
            await Task.Delay(100);
        }
    }

    private static void Signal(string directory, string name)
    {
        string path = Path.Combine(directory, name);
        long qpc = Stopwatch.GetTimestamp(); // Timestamp precedes visibility of the marker file.
        FileStream stream;
        try { stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write); }
        catch (IOException) when (File.Exists(path)) { return; } // Concurrent Ctrl+C and failure cleanup.
        using (stream) JsonSerializer.Serialize(stream, new { qpc }, Program.Json);
    }

    private static async Task WatchAbort(Func<bool> aborted, CancellationTokenSource cancellation)
    {
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                if (aborted()) { cancellation.Cancel(); return; }
                await Task.Delay(250, cancellation.Token);
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
    }

    private static (string Repo, string Node, string Npm) WorkloadPaths()
    {
        string repo = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));
        using var package = JsonDocument.Parse(File.ReadAllText(Path.Combine(repo, "package.json")));
        if (package.RootElement.GetProperty("name").GetString() != "aegis")
            throw new InvalidOperationException("Build and run the probe inside the AEGIS repository");
        foreach (string entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            string node = Path.Combine(entry.Trim('"'), "node.exe");
            string npm = Path.Combine(entry.Trim('"'), "node_modules/npm/bin/npm-cli.js");
            if (Path.IsPathFullyQualified(node) && File.Exists(node) && File.Exists(npm)) return (repo, node, npm);
        }
        throw new FileNotFoundException("Node with its npm CLI must be installed on PATH");
    }

    private static async Task<object> Command(string kind, (string Repo, string Node, string Npm) paths,
        CancellationToken token)
    {
        var start = new ProcessStartInfo(paths.Node)
        {
            WorkingDirectory = paths.Repo,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        start.ArgumentList.Add(paths.Npm);
        if (kind == "npm") start.ArgumentList.Add("--version");
        else if (kind == "build") { start.ArgumentList.Add("run"); start.ArgumentList.Add("build:renderer"); }
        else throw new ArgumentException("Unknown workload");
        long begin = Stopwatch.GetTimestamp();
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Workload did not start");
        // Drain output without keeping project paths or arbitrary build output in artifacts.
        Task stdout = process.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
        Task stderr = process.StandardError.BaseStream.CopyToAsync(Stream.Null);
        try
        {
            await process.WaitForExitAsync(token).WaitAsync(TimeSpan.FromSeconds(60), token);
            await Task.WhenAll(stdout, stderr).WaitAsync(TimeSpan.FromSeconds(5), token);
            if (process.ExitCode != 0) throw new InvalidOperationException("Workload exited unsuccessfully");
            return new { kind, beginQpc = begin, endQpc = Stopwatch.GetTimestamp(), exitCode = process.ExitCode };
        }
        finally { if (!process.HasExited) process.Kill(entireProcessTree: true); }
    }

    internal static async Task<int> Run(string directory, bool simulation, string profile = "load")
    {
        if (Program.Elevated()) throw new InvalidOperationException("Workloads cannot run elevated");
        var paths = WorkloadPaths(); // Validate normal-user dependencies before requesting UAC.
        using var npmPackage = JsonDocument.Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(paths.Npm)!, "../package.json")));
        var plan = StudyPlan.Create(profile, simulation);
        Program.Write(directory, "study.json", new
        {
            schema = 2,
            profile,
            simulation,
            plan,
            workloadElevated = false,
            nodeVersion = FileVersionInfo.GetVersionInfo(paths.Node).ProductVersion,
            npmVersion = npmPackage.RootElement.GetProperty("version").GetString(),
            qpcFrequency = Stopwatch.Frequency,
            workloadCommands = new[] { "npm --version", "npm run build:renderer" },
            interpretation = "npm measures CLI startup, not install. Build rewrites dist/renderer. " +
                "No install or dependency changes. Final command may finish after capture; next capture waits."
        });
        string command = profile == "tune" ? "tune-collector" : "study-collector";
        var start = Program.Child(simulation ? command + "-check" : command, directory);
        start.RedirectStandardInput = start.RedirectStandardOutput = start.RedirectStandardError = false;
        start.UseShellExecute = !simulation;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        if (!simulation) start.Verb = "runas";
        using var cancel = new CancellationTokenSource();
        ConsoleCancelEventHandler handler = (_, e) => { e.Cancel = true; cancel.Cancel(); Signal(directory, "abort.json"); };
        Console.CancelKeyPress += handler;
        try
        {
            using var collector = Process.Start(start) ?? throw new InvalidOperationException("Collector did not start");
            bool Failed() => cancel.IsCancellationRequested || collector.HasExited || File.Exists(Path.Combine(directory, "collector-failure.json"));
            foreach (var run in plan)
            {
                string output = Path.Combine(directory, run.Name);
                await Until(() => File.Exists(Path.Combine(output, "capture-ready.json")), Failed, 90);
                Console.WriteLine("Measuring " + run.Name);
                var commands = new List<object>();
                long begin = Stopwatch.GetTimestamp();
                int nextProgress = 30;
                while (!File.Exists(Path.Combine(output, "capture-stopped.json")))
                {
                    if (Failed() || File.Exists(Path.Combine(output, "failure.json")))
                        throw new InvalidOperationException("Capture failed during workload");
                    double elapsed = (Stopwatch.GetTimestamp() - begin) / (double)Stopwatch.Frequency;
                    if (elapsed > run.Seconds + 75)
                        throw new TimeoutException("Capture stop timed out");
                    if (elapsed >= nextProgress)
                    {
                        Console.WriteLine($"  {run.Name}: {(int)elapsed}/{run.Seconds}s");
                        nextProgress += 30;
                    }
                    string kind = StudyPlan.WorkloadAt(run, elapsed);
                    if (kind == "idle") await Task.Delay(100, cancel.Token);
                    else commands.Add(await Command(kind, paths, cancel.Token));
                }
                if (run.Workload != "idle" && commands.Count == 0)
                    throw new InvalidOperationException("Capture finished before workload began");
                Program.Write(output, "workload.json", new
                {
                    simulation,
                    run.Workload,
                    elevated = false,
                    beginQpc = begin,
                    endQpc = Stopwatch.GetTimestamp(),
                    completedCommands = commands.Count,
                    commands
                });
                Signal(output, "workload-done.json");
            }
            await collector.WaitForExitAsync(cancel.Token).WaitAsync(TimeSpan.FromSeconds(90), cancel.Token);
            Console.WriteLine("Results: " + directory);
            return collector.ExitCode;
        }
        catch (Exception error)
        {
            Signal(directory, "abort.json");
            Program.Write(directory, "workload-failure.json", new { errorType = error.GetType().Name, hresult = error.HResult });
            throw;
        }
        finally { Console.CancelKeyPress -= handler; }
    }

    internal static async Task<int> Collect(string directory, bool simulation, string profile = "load")
    {
        if (!simulation && !Program.Elevated()) return 3;
        directory = Path.GetFullPath(directory);
        if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("Coordinator directory required");
        var outcomes = new List<object>();
        int result = 0;
        bool Aborted() => File.Exists(Path.Combine(directory, "abort.json"));
        try
        {
            foreach (var run in StudyPlan.Create(profile, simulation))
            {
                if (Aborted()) throw new OperationCanceledException("Coordinator aborted");
                string output = Program.NewOutput(Path.Combine(directory, run.Name));
                int code;
                using var captureCancel = new CancellationTokenSource();
                Task abortWatch = WatchAbort(Aborted, captureCancel);
                try
                {
                    if (simulation)
                    {
                        Signal(output, "capture-ready.json");
                        await Task.Delay(run.Seconds * 1000, captureCancel.Token);
                        Signal(output, "capture-stopped.json");
                        code = 0;
                    }
                    else code = await Capture.Run(output, new Options(run.Seconds, "idle", 0x1B0,
                        [10, 12, 13, 14, 15], false, "close", run.BuffersMb), captureCancel.Token);
                }
                finally { captureCancel.Cancel(); await abortWatch; }
                outcomes.Add(new { name = run.Name, workload = run.Workload, exitCode = code });
                if (code != 0) result = 5;
                if (code is not (0 or 5)) break;
                // No next trace while the normal user's final build is still running.
                await Until(() => File.Exists(Path.Combine(output, "workload-done.json")), Aborted, 90);
            }
            Program.Write(directory, "matrix.json", outcomes);
            return result;
        }
        catch (Exception error)
        {
            Program.Write(directory, "collector-failure.json", new { simulation, errorType = error.GetType().Name, hresult = error.HResult });
            return 2;
        }
    }
}
