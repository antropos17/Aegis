using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class FileBroker
{
    internal static async Task<int> Run(string[] args)
    {
        bool live = args[0] == "broker";
        if (Security.Current().Elevated || !FileWire.Id(args[1]) || !FileWire.Id(args[2])) return 3;
        var scope = new FileScope(args[3]); // Validate before any UAC request.
        string pipeId = Guid.NewGuid().ToString("N");
        using var pipe = Security.Server(pipeId);
        if (!Security.RestrictedAcl(pipe)) return 3;
        var self = Security.Current();
        string collector = live ? "collector" : args[0] == "check-loss-broker" ? "check-loss-collector" : "check-collector";
        var info = Program.Child(collector, args[1], args[2], pipeId,
            self.Pid.ToString(), self.Birth.ToString(), scope.Root, FileWire.Profile);
        if (live)
        {
            info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
        }
        // Closing the pipe on expiry prevents a late elevated child from authorizing capture.
        // It does not cancel or dismiss the OS consent dialog.
        using var lifetime = new CancellationTokenSource();
        using var startup = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        using var expire = startup.Token.Register(() => pipe.Dispose());
        using var child = Process.Start(info) ?? throw new InvalidOperationException();
        try
        {
            var identity = Security.Observe(child);
            await pipe.WaitForConnectionAsync(startup.Token);
            Security.Verify(pipe, child, identity.Birth, true, live);
            startup.CancelAfter(Timeout.InfiniteTimeSpan);
            var read = new FileWire(args[1], args[2]);
            var controls = new FileWire(args[1], args[2]);
            int terminalObserved = 0;
            Stream input = Console.OpenStandardInput(), output = Console.OpenStandardOutput();
            var inbound = Task.Run(async () =>
            {
                while (true) await FileWire.Forward(pipe, await controls.Read(input, true, lifetime.Token), lifetime.Token);
            });
            var outbound = Task.Run(async () =>
            {
                while (true)
                {
                    var frame = await read.Read(pipe, false, lifetime.Token);
                    if (frame.t == "stopped") Volatile.Write(ref terminalObserved, 1);
                    await FileWire.Forward(output, frame, lifetime.Token);
                    if (frame.t == "stopped") return;
                }
            });
            try
            {
                var first = await Task.WhenAny(inbound, outbound);
                // Main closes stdin immediately after accepting stopped. Its EOF may
                // win the scheduling race with the outbound task completing its flush.
                if (first == inbound && Volatile.Read(ref terminalObserved) == 0) await inbound;
                await outbound;
                await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(7));
                return child.ExitCode == 0 ? 0 : 2;
            }
            finally
            {
                lifetime.Cancel(); pipe.Dispose(); input.Dispose();
                try { await Task.WhenAll(inbound, outbound).WaitAsync(TimeSpan.FromSeconds(6)); } catch { }
            }
        }
        finally
        {
            pipe.Dispose(); // Independent EOF cleanup trigger; never terminate elevated child.
            try { await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12)); } catch { }
        }
    }
}
