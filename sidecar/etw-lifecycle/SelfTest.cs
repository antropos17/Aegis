using System.Buffers.Binary;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class SelfTest
{
    internal static async Task<int> Run()
    {
        if (Security.Current().Elevated) return 3;
        int passed = 0;
        async Task Test(string name, Func<Task> test) { await test(); passed++; Console.WriteLine("PASS " + name); }
        await Test("native layout", () => { NativeTrace.CheckLayout(); return Task.CompletedTask; });
        await Test("framing and uint64", async () =>
        {
            string id = Guid.NewGuid().ToString("N");
            using var bytes = new MemoryStream();
            var value = Wire.Make(id, ulong.MaxValue, "hello", false);
            await Wire.Write(bytes, value, CancellationToken.None);
            using var split = new SingleByteStream(bytes.ToArray());
            Check(await Wire.Read(split, id, false, CancellationToken.None) == value);
        });
        await Test("invalid length before payload", async () =>
        {
            foreach (int size in new[] { 0, Wire.MaxBytes + 1, int.MaxValue })
            {
                byte[] prefix = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(prefix, size);
                using var stream = new MemoryStream(prefix);
                await Reject(() => Wire.Read(stream, Guid.NewGuid().ToString("N"), false, CancellationToken.None));
            }
        });
        await Test("schema, UTF8, truncation and replay", async () =>
        {
            string id = Guid.NewGuid().ToString("N");
            foreach (var value in new[]
            {
                Wire.Make(id, 1, "hello", false) with { Seq = "01" },
                Wire.Make(id, 1, "hello", false) with { Protocol = "etw-file/1" },
                Wire.Make(id, 1, "hello", false) with { Protocol = "etw-lifecycle/1" },
                Wire.Make(id, 1, "hello", false) with { Live = true },
                Wire.Make(id, 1, "hello", false) with { Id = Guid.NewGuid().ToString("N") }
            }) await Reject(() => { Wire.Validate(value, id, false); return Task.CompletedTask; });
            foreach (var body in new[] { new byte[] { 0xff }, Encoding.UTF8.GetBytes("{}"), Encoding.UTF8.GetBytes("{\"extra\":1}"), Encoding.UTF8.GetBytes("null") })
            {
                byte[] prefix = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(prefix, body.Length);
                using var stream = new MemoryStream([.. prefix, .. body]);
                await Reject(() => Wire.Read(stream, id, false, CancellationToken.None));
            }
            using var partial = new MemoryStream([1, 0]);
            await Reject(() => Wire.Read(partial, id, false, CancellationToken.None));
            ulong seq = 1;
            await Reject(() => { Wire.Next(Wire.Make(id, 1, "hello", false), ref seq); return Task.CompletedTask; });
        });
        await Test("collision never acquires stop authority", async () =>
        {
            var api = new FakeTrace { StartStatus = 183 };
            using (var owned = new OwnedTrace(api)) await Reject(() => { owned.Start(); return Task.CompletedTask; });
            Check(api.Stops == 0);
        });
        await Test("query unknown and idempotent owned stop", () =>
        {
            var api = new FakeTrace { QueryStatus = 5 };
            using (var owned = new OwnedTrace(api))
            {
                Check(owned.Start().EventsLost == null);
                var stop = owned.Stop(); Check(stop.EventsLost == 3 && owned.Stop() == stop);
            }
            Check(api.Stops == 1 && api.StoppedHandle == 123);
            return Task.CompletedTask;
        });
        await Test("failed stop retains ownership for cleanup", () =>
        {
            var api = new FakeTrace { FailFirstStop = true };
            using (var owned = new OwnedTrace(api)) { owned.Start(); Check(owned.Stop().QueryStatus == 5); }
            Check(api.Stops == 2);
            return Task.CompletedTask;
        });
        await Test("restricted ACL, first instance and real mutual identity", async () =>
        {
            string id = Guid.NewGuid().ToString("N"); using var server = Security.Server(id);
            Check(Security.RestrictedAcl(server));
            await Reject(() => { using var duplicate = Security.Server(id); return Task.CompletedTask; });
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var connect = server.WaitForConnectionAsync(deadline.Token);
            using var client = Security.Client(id); await connect;
            using var self = Process.GetCurrentProcess(); ulong birth = Security.Observe(self).Birth;
            Security.Verify(server, self, birth, true, false); Security.Verify(client, self, birth, false, false);
            await Reject(() => { Security.Verify(server, self, birth + 1, true, false); return Task.CompletedTask; });
        });
        await Test("wrong client process rejected even with correct image", async () =>
        {
            string id = Guid.NewGuid().ToString("N"); using var server = Security.Server(id);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var connect = server.WaitForConnectionAsync(deadline.Token);
            using var rogue = Process.Start(Program.Child("rogue", "client", id)) ?? throw new InvalidOperationException();
            try
            {
                await connect; using var self = Process.GetCurrentProcess();
                await Reject(() => { Security.Verify(server, self, Security.Observe(self).Birth, true, false); return Task.CompletedTask; });
            }
            finally { if (!rogue.HasExited) rogue.Kill(); await rogue.WaitForExitAsync(); }
        });
        await Test("wrong server process rejected even with correct image", async () =>
        {
            string id = Guid.NewGuid().ToString("N");
            using var rogue = Process.Start(Program.Child("rogue", "server", id)) ?? throw new InvalidOperationException();
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try
            {
                Check(await Scenarios.Line(rogue.StandardOutput, deadline.Token) == "ready");
                using var client = Security.Client(id); using var self = Process.GetCurrentProcess();
                await Reject(() => { Security.Verify(client, self, Security.Observe(self).Birth, false, false); return Task.CompletedTask; });
            }
            finally { if (!rogue.HasExited) rogue.Kill(); await rogue.WaitForExitAsync(); }
        });
        await Test("missing authorization expires before ready", async () =>
        {
            string id = Guid.NewGuid().ToString("N"); using var server = Security.Server(id);
            string receiptId = Guid.NewGuid().ToString("N"); using var receipt = Security.Server(receiptId);
            var self = Security.Current();
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var connect = server.WaitForConnectionAsync(deadline.Token);
            var receiptConnect = receipt.WaitForConnectionAsync(deadline.Token);
            using var peer = Process.Start(Program.Child("peer", "check", id,
                self.Pid.ToString(System.Globalization.CultureInfo.InvariantCulture), self.Birth.ToString(System.Globalization.CultureInfo.InvariantCulture), "normal", receiptId)) ?? throw new InvalidOperationException();
            try
            {
                await connect; await receiptConnect;
                Check((await Wire.Read(server, id, false, deadline.Token)).Kind == "hello");
                var terminal = await Wire.Read(server, id, false, deadline.Token);
                Check(terminal.Kind == "stopped" && terminal.Code == "lease-expired" && terminal.Stats == null);
                var confirmation = await Wire.Read(receipt, receiptId, false, deadline.Token);
                FinalEvidence.ValidateReceipt(confirmation, "lease-expired", null, true);
                await peer.WaitForExitAsync(deadline.Token); Check(peer.ExitCode == 9);
            }
            finally { if (!peer.HasExited) peer.Kill(); await peer.WaitForExitAsync(); }
        });
        await Test("cancelled coordinator request reports incomplete and terminates broker", async () =>
        {
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            var result = await Scenarios.Run(false, "stop", cancelled.Token);
            Check(!result.Passed && result.Error == "cancelled" && result.BrokerExited);
        });
        await Test("cleanup receipt rejects wrong sequence, reason and conflicting stats", async () =>
        {
            string id = Guid.NewGuid().ToString("N");
            var stats = new TraceStats(0, 0, 0, 0, 256, 64, 4201);
            var valid = Wire.Make(id, 1, "cleanup", true, "stop", stats);
            FinalEvidence.ValidateReceipt(valid, "stop", stats, true);
            foreach (var frame in new[] { valid with { Seq = "2" }, valid with { Kind = "stopped" },
                valid with { Code = "lease-expired" }, valid with { Stats = null },
                valid with { Stats = stats with { EventsLost = 1 } } })
                await Reject(() => { FinalEvidence.ValidateReceipt(frame, "stop", stats, true); return Task.CompletedTask; });
            using var bytes = new MemoryStream();
            await Wire.Write(bytes, valid, CancellationToken.None); bytes.Position = 0;
            await Reject(() => Wire.Read(bytes, Guid.NewGuid().ToString("N"), true, CancellationToken.None));
        });
        await Test("live cleanup needs receipt, known counters, absence and actual exit", () =>
        {
            var stats = new TraceStats(0, 0, 0, 0, 256, 64, 4201);
            var valid = new BrokerResult(true, "blocked-write", true, true, "write-timeout", 10, stats, stats, false, true);
            Check(FinalEvidence.Accepts(true, "blocked-write", valid, 0));
            foreach (var result in new[] { valid with { CleanupReceiptReceived = false }, valid with { PeerExitCode = null },
                valid with { Authenticated = false }, valid with { RestrictedAcl = false }, valid with { StopAcknowledged = true },
                valid with { FinalStats = null }, valid with { FinalStats = stats with { AbsentStatus = 5 } },
                valid with { FinalStats = stats with { EventsLost = null } }, valid with { FinalStats = stats with { QueryStatus = 5 } },
                valid with { Live = false }, valid with { Scenario = "lease" } })
                Check(!FinalEvidence.Accepts(true, "blocked-write", result, 0));
            Check(!FinalEvidence.Accepts(true, "blocked-write", valid, 2));
            return Task.CompletedTask;
        });
        await Test("broker death needs independent presence, absence and held process exits", WitnessTests.Evidence);
        await Test("witness rejects replay, foreign identity and fabricated check statistics", WitnessTests.Protocol);
        await Test("cancelled broker-death check cannot authorize the deliberate kill", WitnessTests.Cancelled);
        await Test("witness bounded framing rejects truncation, excess length and unknown fields", WitnessTests.Framing);
        await Test("read-only collector handle retains identity and exit after process death", WitnessTests.HeldProcess);
        Console.WriteLine($"{passed} lifecycle self-tests passed; no ETW session or elevation.");
        return 0;
    }

    internal static async Task<int> Rogue(string[] args)
    {
        if (args.Length != 3 || Security.Current().Elevated) return 3;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        if (args[1] == "client") { using var pipe = Security.Client(args[2]); await Task.Delay(Timeout.Infinite, deadline.Token); }
        else if (args[1] == "server")
        {
            using var pipe = Security.Server(args[2]); Console.WriteLine("ready");
            await pipe.WaitForConnectionAsync(deadline.Token); await Task.Delay(Timeout.Infinite, deadline.Token);
        }
        else throw new ArgumentException();
        return 0;
    }
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("assertion-failed"); }
    private static async Task Reject(Func<Task> action)
    {
        try { await action(); }
        catch (Exception error) when (error is InvalidDataException or JsonException or IOException or Win32Exception or UnauthorizedAccessException or DecoderFallbackException) { return; }
        throw new InvalidOperationException("rejection-required");
    }
    private sealed class SingleByteStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default) => base.ReadAsync(buffer[..Math.Min(1, buffer.Length)], token);
    }
    private sealed class FakeTrace : ITraceApi
    {
        internal uint StartStatus, QueryStatus; internal bool FailFirstStop;
        internal int Stops; internal ulong StoppedHandle;
        public uint Start(out ulong handle) { handle = 123; return StartStatus; }
        public TraceStats Query() => new(QueryStatus, null, null, null, null, null);
        public TraceStats Stop(ulong handle)
        {
            Stops++; StoppedHandle = handle;
            return FailFirstStop && Stops == 1 ? new(5, null, null, null, null, null) : new(0, 3, 2, 0, 256, 64, 4201);
        }
    }
}
