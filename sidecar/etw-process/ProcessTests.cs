using System.Text;

namespace Aegis.EtwProcess;

internal static class ProcessTests
{
    internal const string Generation = "11111111222233334444555555555555";
    private const ulong Birth = 134000000000000001;
    private static int assertions;
    private static void Check(bool condition) { assertions++; if (!condition) throw new InvalidDataException("fixture-assertion"); }
    private static void Reject(Action action)
    {
        try { action(); } catch (InvalidDataException) { assertions++; return; }
        throw new InvalidDataException("fixture-rejection-missing");
    }
    internal static byte[] Payload(int id = 1, uint pid = 42, ulong birth = Birth, ulong sequence = 9007199254740993)
    {
        var pin = ProcessSchema.Pins.Single(p => p.Id == id);
        using var memory = new MemoryStream();
        using var writer = new BinaryWriter(memory);
        foreach (var field in pin.Fields)
        {
            if (field.Type == 8) writer.Write(field.Name == "ProcessID" ? pid : 0u);
            else if (field.Type is 10 or 17) writer.Write(field.Name == "CreateTime" ? birth :
                field.Name == "ProcessSequenceNumber" ? sequence : 0UL);
            else if (field.Type == 19) writer.Write(new byte[] { 1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0 });
            else writer.Write(field.Type == 1 ? Encoding.Unicode.GetBytes("PRIVATE-USER-PATH\0") : Encoding.ASCII.GetBytes("PRIVATE-USER-PATH\0"));
        }
        return memory.ToArray();
    }
    private static ProcessObservation Decode(int id = 1, byte[]? bytes = null, long qpc = 100) =>
        ProcessDecode.Decode(ProcessSchema.Provider, id, id == 1 ? 4 : 2, id == 1 ? 1 : id == 2 ? 2 : 0,
            id, 777, qpc, bytes ?? Payload(id));
    internal static ProcessFrame[] Frames()
    {
        var ledger = new ProcessLedger(Generation);
        ledger.Observe(() => Decode());
        ledger.BeginStop();
        ledger.Observe(() => Decode(2, qpc: 101));
        return ledger.Finish(0, true, true, new(0, 0));
    }
    private sealed class FakeSession : IProcessSession
    {
        public string Name => "fixture";
        internal bool FailStart, FailEnable;
        internal uint Status;
        internal int StopCalls;
        internal Action? OnStop;
        public void Start() { if (FailStart) throw new IOException(); }
        public void Enable() { if (FailEnable) throw new IOException(); }
        public (uint Status, ProcessLoss Loss) Stop() { StopCalls++; OnStop?.Invoke(); return (Status, new(0, 0)); }
        public void Dispose() { }
    }
    private sealed class FakeConsumer : IProcessConsumer
    {
        internal readonly TaskCompletionSource<bool> Done = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<bool>? Completion { get; private set; }
        internal bool Cancelled;
        public void Start(string name, ProcessLedger ledger) { Completion = Done.Task; }
        public void Cancel() { Cancelled = true; Done.TrySetResult(false); }
        public void Dispose() { }
    }
    internal static async Task<object> Run()
    {
        assertions = 0;
        ProcessSession.VerifyLayout();
        var start = Decode();
        Check(start.SubjectPid == 42 && start.HeaderPid == 777);
        Check(start.CreationTime100ns == "134000000000000001" && start.CreationTimeSource == "payload-CreateTime-FILETIME");
        Check(start.ProviderProcessSequenceNumber == "9007199254740993" && start.ProcessStartKey == null);
        Check(!System.Text.Json.JsonSerializer.Serialize(start).Contains("PRIVATE"));
        Check(Decode(15).Kind == "rundown" && Decode(2).Kind == "stop");
        var unknownBirth = Decode(bytes: Payload(birth: 0, sequence: 0));
        Check(unknownBirth.CreationTime100ns == null && unknownBirth.CreationTimeSource == null && unknownBirth.SequenceSource == null);
        var reused = Decode(bytes: Payload(birth: Birth + 1, sequence: 9007199254740994));
        Check(reused.SubjectPid == start.SubjectPid && reused.CreationTime100ns != start.CreationTime100ns);
        Reject(() => ProcessDecode.Decode(Guid.Empty, 1, 4, 1, 1, 777, 1, Payload()));
        Reject(() => ProcessDecode.Decode(ProcessSchema.Provider, 1, 3, 1, 1, 777, 1, Payload()));
        Reject(() => ProcessDecode.Decode(ProcessSchema.Provider, 1, 4, 2, 1, 777, 1, Payload()));
        Reject(() => ProcessDecode.Decode(ProcessSchema.Provider, 1, 4, 1, 2, 777, 1, Payload()));
        Reject(() => Decode(bytes: Payload(pid: 0)));
        Reject(() => Decode(qpc: -1));
        var payload = Payload();
        for (int length = 0; length < payload.Length; length++) Reject(() => Decode(bytes: payload[..length]));
        Reject(() => Decode(bytes: [.. payload, 0]));
        Reject(() => Decode(bytes: new byte[32769]));
        Reject(() => Decode(2, bytes: Payload(2)[..^1]));
        Reject(() => new ProcessLedger("00000000000000000000000000000000"));
        Reject(() => new ProcessLedger("AAAAAAAA222233334444555555555555"));
        var sid = Payload(); sid[48] = 2;
        Reject(() => Decode(bytes: sid));
        var frames = Frames();
        Check(frames.Select(f => f.Sequence).SequenceEqual(Enumerable.Range(1, 5)));
        Check(frames[2].Type == "stopping" && frames[3].Observation?.Kind == "stop");
        var loss = new ProcessLedger(Generation);
        for (int i = 0; i < ProcessLedger.Capacity + 2; i++) loss.Observe(() => start);
        loss.Observe(() => throw new InvalidDataException());
        loss.BeginStop();
        var receipt = loss.Finish(0, true, true, new(1, 2))[^1].Receipt!;
        Check(receipt.Admitted == 1024 && receipt.Dropped == 2 && receipt.Unknown == 1 && receipt.Callbacks == 1027);
        Check(receipt.Loss.NativeEventsLost == 1 && receipt.Loss.NativeBuffersLost == 2);
        loss.Observe(() => start); // timed-out/closed ledger cannot append late frames
        foreach (bool failStart in new[] { true, false })
        {
            var session = new FakeSession { FailStart = failStart, FailEnable = !failStart };
            var consumer = new FakeConsumer();
            session.OnStop = () => consumer.Done.SetResult(true);
            var capture = new ProcessCapture(session, consumer, new(Generation)); capture.Start();
            var stopped = (await capture.Stop(TimeSpan.FromMilliseconds(50)))[^1].Receipt!;
            Check(stopped.ProviderFailures == 1 && session.StopCalls == (failStart ? 0 : 1));
        }
        var drainLedger = new ProcessLedger(Generation);
        var drainConsumer = new FakeConsumer();
        var drainSession = new FakeSession { OnStop = () => { drainLedger.Observe(() => Decode(2)); drainConsumer.Done.SetResult(true); } };
        var drainCapture = new ProcessCapture(drainSession, drainConsumer, drainLedger); drainCapture.Start();
        var drained = await drainCapture.Stop(TimeSpan.FromMilliseconds(50));
        Check(drained[^2].Observation?.Kind == "stop" && drained[^1].Receipt!.ConsumerSucceeded);
        var timeoutConsumer = new FakeConsumer();
        var timeoutCapture = new ProcessCapture(new FakeSession { Status = 5 }, timeoutConsumer, new(Generation)); timeoutCapture.Start();
        var timeout = (await timeoutCapture.Stop(TimeSpan.FromMilliseconds(1)))[^1].Receipt!;
        Check(timeoutConsumer.Cancelled && !timeout.ConsumerCompleted && !timeout.ConsumerSucceeded && timeout.NativeStopStatus == 5);
        var earlyConsumer = new FakeConsumer();
        var early = new ProcessCapture(new FakeSession(), earlyConsumer, new(Generation)); early.Start(); earlyConsumer.Done.SetResult(true);
        Check(!(await early.Stop(TimeSpan.FromMilliseconds(50)))[^1].Receipt!.ConsumerSucceeded);
        var faultConsumer = new FakeConsumer();
        var faultSession = new FakeSession { OnStop = () => faultConsumer.Done.SetException(new IOException("private-must-not-escape")) };
        var faultCapture = new ProcessCapture(faultSession, faultConsumer, new(Generation)); faultCapture.Start();
        var fault = (await faultCapture.Stop(TimeSpan.FromMilliseconds(50)))[^1].Receipt!;
        Check(fault.ProviderFailures == 1 && fault.ConsumerCompleted && !fault.ConsumerSucceeded);
        return new { assertions, fixtureOnly = true, launchAllowed = false };
    }
}
