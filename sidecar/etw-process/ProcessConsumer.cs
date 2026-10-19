using Microsoft.Diagnostics.Tracing;

namespace Aegis.EtwProcess;

internal interface IProcessConsumer : IDisposable
{
    Task<bool>? Completion { get; }
    void Start(string name, ProcessLedger ledger);
    void Cancel();
}

internal sealed class ProcessConsumer : IProcessConsumer
{
    private ETWTraceEventSource? source;
    public Task<bool>? Completion { get; private set; }
    public void Start(string name, ProcessLedger ledger)
    {
        source = new ETWTraceEventSource(name, TraceEventSourceType.Session);
        source.Dynamic.All += value => Receive(value, ledger);
        source.UnhandledEvents += value => Receive(value, ledger);
        Completion = Task.Factory.StartNew(() => source.Process(), CancellationToken.None,
            TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }
    private static void Receive(TraceEvent value, ProcessLedger ledger)
    {
        if (value.ProviderGuid != ProcessSchema.Provider) return;
        ledger.Observe(() =>
        {
#pragma warning disable CS0618
            long qpc = value.TimeStampQPC;
#pragma warning restore CS0618
            return ProcessDecode.Decode(value.ProviderGuid, (int)value.ID, value.Version, (int)value.Opcode,
                (int)value.Task, unchecked((uint)value.ProcessID), qpc, value.EventData());
        });
    }
    public void Cancel() { source?.StopProcessing(); }
    public void Dispose() { source?.Dispose(); }
}

// This coordinator is fixture-accessible. Production startup never calls it.
// A future native harness must additionally qualify crash/orphan recovery.
internal sealed class ProcessCapture(IProcessSession session, IProcessConsumer consumer, ProcessLedger ledger)
{
    private bool owned, started, stopRequested;
    internal static ProcessCapture Create(string generation)
    {
        ProcessSchema.VerifyInstalled();
        return new(new ProcessSession(generation), new ProcessConsumer(), new ProcessLedger(generation));
    }
    internal void Start()
    {
        if (started || stopRequested) throw new InvalidOperationException("invalid-capture-state");
        started = true;
        try
        {
            session.Start();
            owned = true;
            // Arm the consumer before enabling the selected event IDs.
            consumer.Start(session.Name, ledger);
            session.Enable();
        }
        catch { ledger.ProviderFailure(); }
    }
    internal async Task<ProcessFrame[]> Stop(TimeSpan timeout)
    {
        if (!started || stopRequested || timeout <= TimeSpan.Zero || timeout > TimeSpan.FromSeconds(10))
            throw new InvalidOperationException("invalid-capture-state");
        stopRequested = true;
        ledger.BeginStop();
        bool endedBeforeStop = consumer.Completion?.IsCompleted == true;
        uint? status = null;
        ProcessLoss loss = new(null, null);
        try { if (owned) (status, loss) = session.Stop(); }
        catch { ledger.ProviderFailure(); }
        bool completed = false, succeeded = false;
        var task = consumer.Completion;
        if (task != null)
        {
            if (await Task.WhenAny(task, Task.Delay(timeout)) == task)
            {
                completed = true;
                try { succeeded = await task && !endedBeforeStop; } catch { ledger.ProviderFailure(); }
                consumer.Dispose();
            }
            else
            {
                consumer.Cancel();
                // Closing is postponed until the processing thread actually exits.
                _ = task.ContinueWith(_ => consumer.Dispose(), TaskScheduler.Default);
            }
        }
        return ledger.Finish(status, completed, succeeded, loss);
    }
}
