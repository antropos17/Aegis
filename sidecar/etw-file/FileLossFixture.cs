namespace Aegis.EtwLifecycle;

// Explicit normal-token process-test input. Never used by live capture; no OS
// process queries, file contents, paths outside the fixture root or ETW calls.
internal static class FileLossFixture
{
    internal static void OverflowIngress(FileIngress ingress)
    {
        // Run before starting the mapper: one rejected input plus 4,096 queued
        // inputs discarded at the ensuing gap. All are counted as ingress loss.
        for (int i = 1; i <= 4097; i++) Feed(ingress, 15, i);
    }

    internal static void OverflowOutput(FileIngress ingress, FilePipeline pipeline, FileScope scope)
    {
        Wait(() => ingress.Snapshot().Records == 0);
        long qpc = 10000;
        Feed(ingress, 12, ++qpc, scope.Root + "\\fixture.dat");
        for (int batch = 0; batch < 16; batch++)
        {
            for (int i = 0; i < 512; i++) Feed(ingress, 15, ++qpc);
            Wait(() => ingress.Snapshot().Records == 0);
        }
        Wait(() => pipeline.OutputDropped > 0);
    }

    private static void Feed(FileIngress ingress, int id, long qpc, string? name = null) =>
        ingress.Enqueue(new(0, id, 1, qpc, 71, 72, 72, null, 1, 0, name));

    private static void Wait(Func<bool> ready)
    {
        if (!SpinWait.SpinUntil(ready, TimeSpan.FromSeconds(3))) throw new TimeoutException();
    }
}
