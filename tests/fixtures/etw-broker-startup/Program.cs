using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using static BrokerStartupFixture.BrokerSession;

namespace BrokerStartupFixture;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        (string Name, Func<Task> Run)[] cases =
        [
            ("gated-authentication-deposit-and-custody-order", Ordering),
            ("normal-without-custody", NoCustody),
            ("preparation-between-hellos-and-custody-outlast-peer-budget", IndependentBudgets),
            ("default-eight-second-budgets-cross-former-shared-deadline", DefaultBudgets),
            ("global-cancellation-before-first-hello", () => GlobalCancellation("before")),
            ("global-cancellation-between-hellos", () => GlobalCancellation("between")),
            ("global-cancellation-during-primary", () => GlobalCancellation("primary")),
            ("global-cancellation-during-fallback", () => GlobalCancellation("fallback")),
            ("global-cancellation-during-custody", () => GlobalCancellation("custody")),
            ("primary-peer-deadline", () => PeerDeadline(false, false)),
            ("fallback-peer-deadline", () => PeerDeadline(true, false)),
            ("late-primary-callback-cannot-ack", () => PeerDeadline(false, true)),
            ("late-fallback-callback-cannot-ack", () => PeerDeadline(true, true)),
            ("primary-authentication-refusal", () => Refusal(false)),
            ("fallback-deposit-refusal", () => Refusal(true)),
            ("custody-failure-after-both-acks", CustodyFailure),
            ("invalid-primary-identities", () => ProtocolCases.Identities(false)),
            ("invalid-fallback-identities", () => ProtocolCases.Identities(true)),
            ("mismatched-reservation", ProtocolCases.MismatchedReservation),
            ("malformed-first-hello-frames", () => ProtocolCases.Frames(false)),
            ("malformed-second-hello-frames", () => ProtocolCases.Frames(true)),
            ("connection-budget-bounds", ProtocolCases.BudgetBounds)
        ];
        if (args.Length != 0)
        {
            if (args.Length != 2 || args[0] != "--case" || !cases.Any(test => test.Name == args[1])) return 2;
            cases = cases.Where(test => test.Name == args[1]).ToArray();
        }
        var elapsed = Stopwatch.StartNew();
        foreach (var test in cases)
        {
            try { await test.Run().WaitAsync(TimeSpan.FromSeconds(20)); }
            catch (Exception error)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new
                { test = test.Name, error = error.GetType().Name, detail = error.Message }));
                return 1;
            }
        }
        Console.WriteLine(JsonSerializer.Serialize(new { schema = "aegis-broker-startup-fixture/1",
            passed = cases.Length, failed = 0, cases = cases.Select(test => test.Name).ToArray(),
            productionAssembly = "EtwFile",
            productionAssemblySha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(Assembly.Load("EtwFile").Location))),
            nativeAuthentication = false, etwInvoked = false, elevationRequested = false,
            elapsedMs = elapsed.ElapsedMilliseconds }));
        return 0;
    }

    private static async Task Ordering()
    {
        await using var session = await BrokerSession.Create();
        var verified = Signal(); var primaryRelease = Signal();
        var fallbackVerified = Signal(); var deposited = Signal(); var depositRelease = Signal();
        var custody = Signal(); var custodyRelease = Signal();
        Task? secondAck = null;
        var run = session.Run(async token => { verified.SetResult(); await primaryRelease.Task.WaitAsync(token); },
            async token =>
            {
                fallbackVerified.SetResult(); await deposited.Task.WaitAsync(token);
                await depositRelease.Task.WaitAsync(token);
            }, async token =>
            {
                // Reading ACK2 inside custody would deadlock if custody ran before its write.
                await secondAck!.WaitAsync(token); custody.SetResult(); await custodyRelease.Task.WaitAsync(token);
            }, TimeSpan.FromSeconds(2));
        await session.Hello(); await verified.Task.WaitAsync(Limit); await session.NoAck();
        Require(session.FallbackCalls == 0 && session.CustodyCalls == 0, "premature next stage");
        primaryRelease.SetResult(); await session.Ack();
        await session.Hello(true); await fallbackVerified.Task.WaitAsync(Limit); await session.NoAck();
        deposited.SetResult(); await session.NoAck();
        Require(session.CustodyCalls == 0, "custody before deposit/ACK");
        secondAck = session.Ack(); depositRelease.SetResult();
        await custody.Task.WaitAsync(Limit); Require(!run.IsCompleted, "custody must be awaited");
        custodyRelease.SetResult(); await run;
        Require(session.PrimaryCalls == 1 && session.FallbackCalls == 1 && session.CustodyCalls == 1, "stage counts");
    }

    private static async Task NoCustody()
    {
        await using var session = await BrokerSession.Create();
        var run = session.Run(); await session.Hello(); await session.Ack();
        await session.Hello(true); await session.Ack(); await run;
        Require(session.CustodyCalls == 0 && session.PrimaryCalls == 1 && session.FallbackCalls == 1, "normal completion");
    }

    private static async Task IndependentBudgets()
    {
        await using var session = await BrokerSession.Create();
        CancellationToken first = default, second = default;
        var run = session.Run(token => { first = token; return Task.CompletedTask; },
            token => { second = token; return Task.CompletedTask; },
            async token =>
            {
                Require(token == session.Startup.Token, "custody must use global cap");
                await Task.Delay(200, token);
                Require(!first.IsCancellationRequested && !second.IsCancellationRequested, "disposed peer deadlines");
            }, TimeSpan.FromMilliseconds(80));
        await Task.Delay(200); await session.Hello(); await session.Ack();
        await Task.Delay(200); Require(!first.IsCancellationRequested, "first deadline survived ACK");
        await session.Hello(true); await session.Ack(); await run;
    }

    private static async Task DefaultBudgets()
    {
        await using var session = await BrokerSession.Create(TimeSpan.FromSeconds(16));
        var elapsed = Stopwatch.StartNew();
        var run = session.Run(token => Task.Delay(4000, token), token => Task.Delay(3000, token));
        await Task.Delay(2000); await session.Hello(); await session.Ack(TimeSpan.FromSeconds(6));
        await Task.Delay(2000); await session.Hello(true); await session.Ack(); await run;
        Require(elapsed.Elapsed >= TimeSpan.FromSeconds(10), "real unscaled deadline regression");
    }

    private static async Task GlobalCancellation(string stage)
    {
        await using var session = await BrokerSession.Create();
        var entered = Signal();
        Task Wait(CancellationToken token) { entered.TrySetResult(); return Task.Delay(Timeout.Infinite, token); }
        var run = session.Run(stage == "primary" ? Wait : null, stage == "fallback" ? Wait : null,
            stage == "custody" ? Wait : null);
        if (stage != "before")
        {
            await session.Hello();
            if (stage != "primary") await session.Ack();
            if (stage is "fallback" or "custody")
            {
                await session.Hello(true);
                if (stage == "custody") await session.Ack();
            }
            if (stage is "primary" or "fallback" or "custody") await entered.Task.WaitAsync(Limit);
        }
        session.Startup.Cancel(); await Error<OperationCanceledException>(run); await session.NoAck();
        Require(session.PrimaryCalls == (stage == "before" ? 0 : 1) &&
            session.FallbackCalls == (stage is "fallback" or "custody" ? 1 : 0), "canceled stage invocation counts");
        Require(session.CustodyCalls == (stage == "custody" ? 1 : 0), "global cancellation stage");
    }

    private static async Task PeerDeadline(bool fallback, bool late)
    {
        await using var session = await BrokerSession.Create();
        var canceled = Signal(); var release = Signal();
        async Task Wait(CancellationToken token)
        {
            using var notice = token.Register(() => canceled.TrySetResult());
            if (late) await release.Task; else await Task.Delay(Timeout.Infinite, token);
        }
        var run = session.Run(fallback ? null : Wait, fallback ? Wait : null,
            _ => throw new InvalidOperationException("custody after canceled peer"), TimeSpan.FromMilliseconds(100));
        await session.Hello();
        if (fallback) { await session.Ack(); await session.Hello(true); }
        await canceled.Task.WaitAsync(Limit);
        if (late) { await session.NoAck(); release.SetResult(); }
        await Error<OperationCanceledException>(run); await session.NoAck();
        Require(!session.Startup.IsCancellationRequested && session.CustodyCalls == 0, "peer cap isolation");
    }

    private static async Task Refusal(bool fallback)
    {
        await using var session = await BrokerSession.Create();
        Task Deny(CancellationToken _) => throw new InvalidDataException("fixture native-boundary refusal");
        var run = session.Run(fallback ? null : Deny, fallback ? Deny : null);
        await session.Hello(); if (fallback) { await session.Ack(); await session.Hello(true); }
        await Error<InvalidDataException>(run); await session.NoAck();
        Require(session.CustodyCalls == 0, "refused native boundary");
    }

    private static async Task CustodyFailure()
    {
        await using var session = await BrokerSession.Create();
        Task? ack = null;
        var run = session.Run(custody: async token =>
        {
            await ack!.WaitAsync(token);
            throw new IOException("fixture custody refusal");
        });
        await session.Hello(); await session.Ack();
        ack = session.Ack(); await session.Hello(true);
        await Error<IOException>(run); await ack;
        Require(session.PrimaryCalls == 1 && session.FallbackCalls == 1 && session.CustodyCalls == 1,
            "custody failure preserved completed peer stages");
    }
}
