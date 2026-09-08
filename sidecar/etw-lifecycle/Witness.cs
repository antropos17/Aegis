using System.Diagnostics;
using System.Globalization;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

// Independent query-only transport; no session name, executable or output path is accepted.
internal sealed record WitnessFrame(string Protocol, string Id, string Phase, bool Live,
    bool Reply, TraceStats? Stats);

internal sealed class Witness : IDisposable
{
    private readonly string id;
    private readonly bool live;
    private readonly NamedPipeServerStream pipe;
    private readonly Process process;
    private readonly StreamReader reader;
    private int queries;
    private readonly string[] phases;
    internal bool RestrictedAcl { get; }
    internal bool Authenticated { get; private set; }
    internal bool Exited => process.HasExited;
    internal int? ExitCode => Exited ? process.ExitCode : null;

    private Witness(string id, bool live, NamedPipeServerStream pipe, Process process, bool acl, bool suspend)
    {
        this.id = id; this.live = live; this.pipe = pipe; this.process = process;
        RestrictedAcl = acl; reader = Reader(pipe);
        phases = suspend ? ["preflight", "before", "after"] : ["before", "after"];
    }

    internal static async Task<Witness> Start(bool live, CancellationToken token, bool suspend = false)
    {
        token.ThrowIfCancellationRequested();
        if (Security.Current().Elevated) throw new UnauthorizedAccessException();
        string id = Guid.NewGuid().ToString("N");
        var pipe = Security.Server(id);
        Witness? witness = null;
        try
        {
            bool acl = Security.RestrictedAcl(pipe);
            if (!acl) throw new UnauthorizedAccessException();
            var self = Security.Current();
            var info = Program.Child(suspend ? "witness-suspend" : "witness", live ? "live" : "check", id,
                self.Pid.ToString(CultureInfo.InvariantCulture), self.Birth.ToString(CultureInfo.InvariantCulture));
            if (live)
            {
                info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden;
                info.RedirectStandardInput = false; info.RedirectStandardOutput = false; info.RedirectStandardError = false;
            }
            // Consent itself has no cancellable deadline. A late helper still needs this held parent.
            var process = Process.Start(info) ?? throw new InvalidOperationException();
            witness = new(id, live, pipe, process, acl, suspend);
            ulong birth = Security.Observe(process).Birth;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
            deadline.CancelAfter(TimeSpan.FromSeconds(10));
            await pipe.WaitForConnectionAsync(deadline.Token);
            Security.Verify(pipe, process, birth, true, live);
            await Read(witness.reader, id, "hello", live, true, deadline.Token);
            witness.Authenticated = true;
            return witness;
        }
        catch
        {
            pipe.Dispose();
            if (witness != null) { await witness.Finish(); witness.Dispose(); }
            throw;
        }
    }

    internal async Task<TraceStats?> Query(string phase, CancellationToken token)
    {
        if (!Authenticated || queries >= phases.Length || phase != phases[queries])
            throw new InvalidDataException();
        queries++; // a failed exchange cannot be retried on partially consumed framing
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        await Write(pipe, new("etw-witness/1", id, phase, live, false, null), deadline.Token);
        return (await Read(reader, id, phase, live, true, deadline.Token)).Stats;
    }

    internal async Task Finish()
    {
        pipe.Dispose();
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(7)); }
        catch (TimeoutException) { /* No elevated kill or cleanup authority. The result remains incomplete. */ }
    }

    public void Dispose() { reader.Dispose(); pipe.Dispose(); process.Dispose(); }

    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 5 || args[0] is not ("witness" or "witness-suspend") || args[1] is not ("live" or "check")) throw new ArgumentException();
        bool suspend = args[0] == "witness-suspend";
        bool live = args[1] == "live";
        if (Security.Current().Elevated != live) return 3;
        string id = args[2];
        using var parent = Process.GetProcessById(int.Parse(args[3], CultureInfo.InvariantCulture));
        using var pipe = Security.Client(id);
        Security.Verify(pipe, parent, ulong.Parse(args[4], CultureInfo.InvariantCulture), false, false);
        using var reader = Reader(pipe);
        using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(suspend ? 720 : 165));
        using (var hello = new CancellationTokenSource(TimeSpan.FromSeconds(2)))
            await Write(pipe, new("etw-witness/1", id, "hello", live, true, null), hello.Token);
        foreach (string phase in suspend ? new[] { "preflight", "before", "after" } : new[] { "before", "after" })
        {
            await Read(reader, id, phase, live, false, lifetime.Token);
            // This helper has exactly one native operation: QUERY of the fixed harness name.
            // Check mode never queries ETW and cannot emit fabricated native statistics.
            TraceStats? stats = live ? new NativeTrace().Query() : null;
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await Write(pipe, new("etw-witness/1", id, phase, live, true, stats), deadline.Token);
        }
        return 0;
    }

    internal static void Validate(WitnessFrame frame, string id, string phase, bool live, bool reply)
    {
        if (frame.Protocol != "etw-witness/1" || !Guid.TryParseExact(id, "N", out _) || frame.Id != id ||
            phase is not ("hello" or "preflight" or "before" or "after") || frame.Phase != phase || frame.Live != live ||
            frame.Reply != reply || ((!live || !reply || phase == "hello") && frame.Stats != null))
            throw new InvalidDataException();
    }

    private static StreamReader Reader(Stream pipe) => new(pipe, new UTF8Encoding(false, true), false, 1024, true);
    internal static async Task<WitnessFrame> Read(StreamReader reader, string id, string phase, bool live, bool reply, CancellationToken token)
    {
        var frame = JsonSerializer.Deserialize<WitnessFrame>(await Scenarios.Line(reader, token), Wire.Json)
            ?? throw new InvalidDataException();
        Validate(frame, id, phase, live, reply);
        return frame;
    }
    internal static async Task Write(Stream pipe, WitnessFrame frame, CancellationToken token)
    {
        Validate(frame, frame.Id, frame.Phase, frame.Live, frame.Reply);
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(frame, Wire.Json);
        if (bytes.Length > 4095) throw new InvalidDataException();
        await pipe.WriteAsync(bytes, token);
        await pipe.WriteAsync(new byte[] { 10 }, token);
        await pipe.FlushAsync(token);
    }
}
