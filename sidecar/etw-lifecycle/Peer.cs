using System.Diagnostics;
using System.Globalization;

namespace Aegis.EtwLifecycle;

internal static class Peer
{
    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 6 || args[1] is not ("check" or "live") ||
            args[5] is not ("normal" or "exit" or "flood")) throw new ArgumentException();
        bool live = args[1] == "live";
        if (live && args[5] != "normal") throw new ArgumentException();
        if (Security.Current().Elevated != live) return 3;
        string id = args[2];
        using var parent = Process.GetProcessById(int.Parse(args[3], CultureInfo.InvariantCulture));
        ulong birth = ulong.Parse(args[4], CultureInfo.InvariantCulture);
        using var pipe = Security.Client(id);
        Security.Verify(pipe, parent, birth, false, false);
        using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        using var ownerGone = new CancellationTokenSource();
        using var io = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, ownerGone.Token);
        var watch = Watch(parent, ownerGone, lifetime.Token);
        using var trace = live ? new OwnedTrace(new NativeTrace()) : null;
        ulong sent = 0, received = 0;
        bool writing = false;
        string reason = "peer-failed";
        try
        {
            await Send("hello");
            var authorize = await Read();
            if (authorize.Kind != "authorize") throw new InvalidDataException();
            TraceStats? initial = trace?.Start();
            await Send("ready", stats: initial);
            if (args[5] == "exit") return 7; // simulated collector exit, no ETW session
            if (args[5] == "flood")
            {
                for (int i = 0; i < 512; i++) await Send("padding", padding: new string('x', 16384));
                throw new InvalidDataException("flood-not-blocked");
            }
            while (true)
            {
                Frame frame = await Read();
                if (frame.Kind == "stop") { reason = frame.Code; break; }
                if (frame.Kind != "ping") throw new InvalidDataException();
                await Send("pong");
            }
        }
        catch (OperationCanceledException) { reason = ownerGone.IsCancellationRequested ? "parent-eof" : writing ? "write-timeout" : "lease-expired"; }
        catch (IOException) { reason = "parent-eof"; }
        finally
        {
            TraceStats? final = trace?.StopIfOwned();
            // Cleanup never waits for a writable broker pipe. The terminal frame has
            // its own short deadline and cannot prevent stopping the owned session.
            try
            {
                using var terminal = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                await Wire.Write(pipe, Wire.Make(id, ++sent, "stopped", live, reason, final), terminal.Token);
            }
            catch (Exception error) when (error is IOException or OperationCanceledException) { }
            lifetime.Cancel();
            await watch;
        }
        return reason switch { "stop" or "parent-eof" => 0, "lease-expired" => 9, "write-timeout" => 10, _ => 2 };

        async Task Send(string kind, TraceStats? stats = null, string padding = "")
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(io.Token);
            deadline.CancelAfter(TimeSpan.FromSeconds(2));
            writing = true;
            await Wire.Write(pipe, Wire.Make(id, ++sent, kind, live, stats: stats, padding: padding), deadline.Token);
            writing = false;
        }
        async Task<Frame> Read()
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(io.Token);
            deadline.CancelAfter(TimeSpan.FromSeconds(4));
            var frame = await Wire.Read(pipe, id, live, deadline.Token);
            Wire.Next(frame, ref received);
            return frame;
        }
    }

    private static async Task Watch(Process parent, CancellationTokenSource gone, CancellationToken done)
    {
        try
        {
            await parent.WaitForExitAsync(done);
            gone.Cancel();
        }
        catch (OperationCanceledException) { }
    }
}
