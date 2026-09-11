namespace Aegis.EtwLifecycle;

internal static class FilePumpWait
{
    // Borrowed tasks outlive this wait. Cancel the losing deadline, and let
    // WhenAny detach its other continuations when a signal wins. No queue waiter
    // is left behind on timeout, stop, failure or cancellation.
    internal static async Task WaitAsync(Task output, Task mapper, Task? capture, Task? stop,
        TimeSpan timeout, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        var delay = Task.Delay(timeout, deadline.Token);
        try
        {
            var ready = await Task.WhenAny(output, mapper, capture ?? mapper, stop ?? mapper, delay);
            token.ThrowIfCancellationRequested();
            await ready; // Preserve mapper/capture failures for the owner's cleanup path.
        }
        finally { deadline.Cancel(); }
    }
}
