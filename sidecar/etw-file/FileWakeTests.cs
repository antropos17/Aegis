namespace Aegis.EtwLifecycle;

internal static class FileWakeTests
{
    private static readonly TimeSpan Bound = TimeSpan.FromSeconds(3);
    internal static void Run(Action<string, Action> test)
    {
        test("empty output wakes on enqueue without a polling deadline", () =>
        {
            using var fixture = new Fixture();
            var waiting = fixture.Wait();
            Check(!waiting.IsCompleted, "empty-output-was-ready");
            fixture.Read();
            waiting.WaitAsync(Bound).GetAwaiter().GetResult();
            Check(fixture.Pipeline.Take()?.eventId == 15, "woken-without-record");
        });
        test("enqueue between empty read and wait registration remains visible", () =>
        {
            using var fixture = new Fixture();
            Check(fixture.Pipeline.Take() == null, "not-empty");
            var signal = fixture.Pipeline.OutputAvailable;
            fixture.Read(); signal.WaitAsync(Bound).GetAwaiter().GetResult();
            Check(fixture.Pipeline.OutputAvailable.IsCompletedSuccessfully, "lost-ready-state");
            fixture.Wait().WaitAsync(Bound).GetAwaiter().GetResult();
            Check(fixture.Pipeline.Take() != null, "lost-record");
            Check(!fixture.Pipeline.OutputAvailable.IsCompleted, "drain-did-not-reset");
        });
        test("repeated drain and invalidation rearm one notification", () =>
        {
            using var fixture = new Fixture();
            for (int i = 0; i < 1000; i++)
            {
                var signal = fixture.Pipeline.OutputAvailable;
                Check(!signal.IsCompleted && ReferenceEquals(signal, fixture.Pipeline.OutputAvailable), "extra-notification");
                fixture.Read(); signal.WaitAsync(Bound).GetAwaiter().GetResult();
                Check(fixture.Pipeline.Take() != null, "missed-cycle");
            }
            var pending = fixture.Pipeline.OutputAvailable;
            fixture.Pipeline.Invalidate(fixture.Qpc);
            Check(ReferenceEquals(pending, fixture.Pipeline.OutputAvailable), "empty-invalidation-orphaned-waiter");
            fixture.Name(); fixture.Read(); pending.WaitAsync(Bound).GetAwaiter().GetResult();
            fixture.Pipeline.Invalidate(fixture.Qpc);
            Check(fixture.Pipeline.Take() == null && !fixture.Pipeline.OutputAvailable.IsCompleted, "stale-ready-after-invalidation");
            Check(fixture.Pipeline.OutputDropped == 1, "invalidation-accounting");
        });
        test("stop wakes empty capture and is excluded from drain waits", () =>
        {
            using var fixture = new Fixture();
            var stop = NewSignal();
            var waiting = fixture.Wait(stop: stop.Task);
            stop.SetResult(true); waiting.WaitAsync(Bound).GetAwaiter().GetResult();
            var drain = fixture.Wait();
            Check(!drain.IsCompleted, "completed-stop-spins-drain");
            fixture.Pipeline.Complete(); drain.WaitAsync(Bound).GetAwaiter().GetResult();
            Check(fixture.Pipeline.Worker.IsCompletedSuccessfully, "mapper-not-drained");
        });
        test("mapper cancellation wakes an empty pump", () =>
        {
            using var fixture = new Fixture();
            var waiting = fixture.Wait();
            fixture.Pipeline.Cancel(); waiting.WaitAsync(Bound).GetAwaiter().GetResult();
            Check(fixture.Pipeline.Worker.IsCompleted, "mapper-still-running");
        });
        foreach (bool capture in new[] { false, true })
        {
            test(capture ? "capture failure wakes pump" : "mapper failure wakes pump", () =>
            {
                var failed = NewSignal(); var pending = NewSignal();
                var waiting = FilePumpWait.WaitAsync(pending.Task, capture ? pending.Task : failed.Task,
                    capture ? failed.Task : null, null, Timeout.InfiniteTimeSpan, default);
                failed.SetException(new IOException("fixture-failure"));
                bool rejected = false;
                try { waiting.WaitAsync(Bound).GetAwaiter().GetResult(); } catch (IOException) { rejected = true; }
                Check(rejected, "failure-hidden");
            });
        }
        test("cancelling one idle wait does not consume or poison the next output", () =>
        {
            using var fixture = new Fixture();
            using var cancel = new CancellationTokenSource();
            var waiting = fixture.Wait(token: cancel.Token);
            cancel.Cancel();
            bool rejected = false;
            try { waiting.WaitAsync(Bound).GetAwaiter().GetResult(); } catch (OperationCanceledException) { rejected = true; }
            Check(rejected, "cancellation-hidden");
            var next = fixture.Wait();
            Check(!next.IsCompleted, "cancelled-shared-notification");
            fixture.Read(); next.WaitAsync(Bound).GetAwaiter().GetResult();
            Check(fixture.Pipeline.Take() != null, "cancellation-consumed-record");
        });
        test("heartbeat deadline wakes an empty pump without poisoning its signal", () =>
        {
            using var fixture = new Fixture();
            var signal = fixture.Pipeline.OutputAvailable;
            FilePumpWait.WaitAsync(signal, fixture.Pipeline.Worker, null, null,
                TimeSpan.FromMilliseconds(20), default).WaitAsync(Bound).GetAwaiter().GetResult();
            Check(!signal.IsCompleted, "deadline-completed-shared-signal");
            var next = fixture.Wait(); fixture.Read();
            next.WaitAsync(Bound).GetAwaiter().GetResult();
            Check(fixture.Pipeline.Take() != null, "timeout-consumed-record");
        });
        test("completed mapper still leaves buffered output drainable", () =>
        {
            using var fixture = new Fixture();
            for (int i = 0; i < 100; i++) fixture.Read();
            fixture.Pipeline.Complete(); fixture.Pipeline.Worker.WaitAsync(Bound).GetAwaiter().GetResult();
            fixture.Wait().WaitAsync(Bound).GetAwaiter().GetResult();
            int count = 0;
            while (fixture.Pipeline.Take() != null) count++;
            Check(count == 100 && fixture.Pipeline.OutputDropped == 0, "incomplete-final-drain");
        });
    }
    private static TaskCompletionSource<bool> NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static void Check(bool value, string reason) { if (!value) throw new InvalidOperationException(reason); }
    private sealed class Fixture : IDisposable
    {
        private readonly FileIngress ingress = new();
        internal readonly FilePipeline Pipeline;
        internal long Qpc;
        internal Fixture()
        {
            Pipeline = new FilePipeline(ingress, new FileScope(@"C:\fixture", false), false);
            Name();
        }
        internal void Name() => ingress.Enqueue(new(0, 12, 1, ++Qpc, 71, 72, 72, null, 1, 0, @"C:\fixture\a"));
        internal void Read() => ingress.Enqueue(new(0, 15, 1, ++Qpc, 71, 72, 72, null, 1, 0, null));
        internal Task Wait(Task? stop = null, CancellationToken token = default) =>
            FilePumpWait.WaitAsync(Pipeline.OutputAvailable, Pipeline.Worker, null, stop, Timeout.InfiniteTimeSpan, token);
        public void Dispose()
        {
            Pipeline.Cancel(); Pipeline.Worker.WaitAsync(Bound).GetAwaiter().GetResult(); Pipeline.Dispose();
        }
    }
}
