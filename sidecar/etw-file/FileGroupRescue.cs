namespace Aegis.EtwLifecycle;

// A one-shot normal cleanup controller, created only by the original surviving main.
internal static class FileGroupRescue
{
    internal static async Task<int> Run(string[] args)
    {
        if (Security.Current().Elevated || !FileWire.Id(args[1]) || !FileWire.Id(args[2])) return 3;
        Stream input = Console.OpenStandardInput(), output = Console.OpenStandardOutput();
        using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(170));
        var read = new FileWire(args[1], args[2]);
        Envelope request;
        using (var startup = new CancellationTokenSource(TimeSpan.FromSeconds(8)))
            request = await read.Read(input, true, startup.Token);
        if (request.t != "rescue") throw new InvalidDataException();
        var lease = FileMainWire.ValidateRescue(request.data);
        using var custody = FileMainCustody.Retrieve(lease);
        var watchOwner = Task.Run(async () =>
        {
            try
            {
                while (!custody.OwnerGone) await Task.Delay(50, lifetime.Token);
                lifetime.Cancel();
            }
            catch (OperationCanceledException) { }
        });
        try
        {
            await custody.WaitForAllExits();
            lifetime.Token.ThrowIfCancellationRequested();
            int[] exits = custody.OriginalCodes;
            var send = new FileWire(args[1], args[2]);
            send.ContinueAfter(ulong.Parse(request.data.GetProperty("lastSeq").GetString()!));
            FileGuardResult Recover() => FileGroupRecovery.Recover(lease.guid, custody.OriginalExits);
            var receipt = args[0] == "rescue-denial-check" ? FileRecoveryAccess.RestrictedProbe(Recover) : Recover();
            bool denied = FileRecoveryAccess.NeedsConsent(receipt), elevated = false;
            if (denied)
            {
                await send.Write(output, "recovering", new
                { cause = "broker-and-all-helpers-exited", queryStatus = 5, consentDeadlineMs = 120000 }, lifetime.Token);
                using (var ackLimit = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
                {
                    ackLimit.CancelAfter(TimeSpan.FromSeconds(8));
                    var ack = await read.Read(input, true, ackLimit.Token);
                    if (ack.t != "consent-ack") throw new InvalidDataException();
                }
                receipt = await FileRecoveryConsent.Start(lease.guid, lifetime.Token);
                elevated = true;
            }
            lifetime.Token.ThrowIfCancellationRequested();
            if (receipt.kind != "recovered" || !receipt.stopped || !receipt.absent) throw new IOException();
            custody.ReleaseDeposits(true);
            var counters = receipt.counters ?? new FileStats(50, null, null, null, null, null);
            await send.Write(output, "recovered", new
            {
                cause = "broker-and-all-helpers-exited", stopped = true, absent = true,
                brokerExit = exits[0], collectorExit = exits[1],
                peers = new { guardExit = exits[2], fallbackExit = exits[3], brokerElevated = false,
                    cleanupElevated = elevated, accessDenied = denied },
                counters = new { queryStatus = counters.Status, eventsLost = counters.Events?.ToString(),
                    realTimeBuffersLost = counters.RealTime?.ToString(), logBuffersLost = counters.Log?.ToString(), asOfQpc = receipt.asOfQpc },
                finalTotals = (object?)null, observationGap = true
            }, lifetime.Token);
            return 4;
        }
        finally { lifetime.Cancel(); try { await watchOwner; } catch { } }
    }
}
