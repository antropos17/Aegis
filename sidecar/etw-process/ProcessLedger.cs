namespace Aegis.EtwProcess;

internal sealed record ProcessLoss(uint? NativeEventsLost, uint? NativeBuffersLost);
internal sealed record ProcessReceipt(int Callbacks, int Admitted, int Unknown, int Dropped,
    int ProviderFailures, uint? NativeStopStatus, bool ConsumerCompleted, bool ConsumerSucceeded,
    ProcessLoss Loss);
internal sealed record ProcessFrame(string Protocol, int Version, string Provider, string Generation, int Sequence,
    string Type, ProcessObservation? Observation = null, ProcessReceipt? Receipt = null);

// This bounded ledger is deliberately disconnected from population/identity,
// file attribution, audit, risk and renderer state.
internal sealed class ProcessLedger
{
    internal const string Protocol = "aegis-etw-process-diagnostic";
    internal const int Capacity = 1024;
    private readonly object gate = new();
    private readonly List<ProcessFrame> frames = [];
    private readonly string generation;
    private int wireSequence, callbacks, admitted, unknown, dropped, providerFailures;
    private bool stopping, complete;
    internal ProcessLedger(string generation)
    {
        if (!Guid.TryParseExact(generation, "N", out var value) || value == Guid.Empty || value.ToString("N") != generation)
            throw new InvalidDataException("invalid-generation");
        this.generation = generation;
        Add("begin");
    }
    private void Add(string type, ProcessObservation? observation = null, ProcessReceipt? receipt = null) =>
        frames.Add(new(Protocol, 1, ProcessSchema.Provider.ToString(), generation, ++wireSequence, type, observation, receipt));

    internal void Observe(Func<ProcessObservation> decode)
    {
        lock (gate)
        {
            if (complete) return; // A timed-out consumer cannot amend its incomplete receipt.
            callbacks++;
            // Stopping changes lifecycle state, not observation admission. The
            // consumer may still deliver buffered records until Process returns.
            ProcessObservation observation;
            try { observation = decode(); }
            catch { unknown++; return; }
            if (admitted >= Capacity) { dropped++; return; }
            admitted++;
            Add("event", observation);
        }
    }
    internal void ProviderFailure()
    {
        lock (gate)
        {
            if (complete) throw new InvalidOperationException("capture-completed");
            providerFailures++;
        }
    }
    internal void BeginStop()
    {
        lock (gate)
        {
            if (stopping || complete) throw new InvalidOperationException("capture-stopping");
            stopping = true;
            Add("stopping");
        }
    }
    internal ProcessFrame[] Finish(uint? nativeStop, bool consumerCompleted, bool consumerSucceeded, ProcessLoss loss)
    {
        lock (gate)
        {
            if (!stopping || complete) throw new InvalidOperationException("invalid-stop-state");
            complete = true;
            Add("stop", receipt: new(callbacks, admitted, unknown, dropped, providerFailures,
                nativeStop, consumerCompleted, consumerSucceeded, loss));
            return frames.ToArray();
        }
    }
}
