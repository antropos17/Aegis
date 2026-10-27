namespace Aegis.EtwLifecycle;

internal sealed class FileGuardPeerExitedException : IOException
{
    internal int ExitCode { get; }
    internal FileGuardPeerExitedException(int exitCode) : base("Guard exited during startup.") => ExitCode = exitCode;
}

// One existing startup deadline covers every step. The original child exiting
// cancels pending I/O even when its pipe remains open in another process.
internal sealed class FileGuardStartup : IDisposable
{
    private readonly Task peerExited;
    private readonly Func<int> getExitCode;
    private readonly CancellationTokenSource stop;
    private readonly CancellationTokenSource observerStop = new();
    private readonly CancellationToken token;
    private bool disposed;

    internal FileGuardStartup(Task peerExited, Func<int> getExitCode, CancellationToken startupToken)
    {
        this.peerExited = peerExited;
        this.getExitCode = getExitCode;
        stop = CancellationTokenSource.CreateLinkedTokenSource(startupToken);
        token = stop.Token;
        _ = ObservePeer();
    }

    private async Task ObservePeer()
    {
        try
        {
            await peerExited.WaitAsync(observerStop.Token).ConfigureAwait(false);
            stop.Cancel();
        }
        // A canceled/faulted exit watcher is not evidence that the child exited.
        // Disposal can race the successful exit observer's cancellation.
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (Exception) { }
    }

    private void ThrowIfPeerExited()
    {
        if (peerExited.IsCompletedSuccessfully) throw new FileGuardPeerExitedException(getExitCode());
    }

    internal Task Wait(Func<CancellationToken, Task> operation) => Wait(async cancellation =>
    {
        await operation(cancellation).ConfigureAwait(false);
        return true;
    });

    internal async Task<T> Wait<T>(Func<CancellationToken, Task<T>> operation)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        ThrowIfPeerExited();
        token.ThrowIfCancellationRequested();
        Task<T>? pending = null;
        try
        {
            pending = operation(token);
            T result = await pending.WaitAsync(token).ConfigureAwait(false);
            ThrowIfPeerExited();
            token.ThrowIfCancellationRequested();
            return result;
        }
        catch
        {
            // A provider may complete after cancellation. Observe a late fault
            // without retaining this helper or waiting beyond the shared budget.
            if (pending != null)
                _ = pending.ContinueWith(static task => { _ = task.Exception; }, CancellationToken.None,
                    TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            ThrowIfPeerExited();
            throw;
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        observerStop.Cancel();
        try { stop.Cancel(); }
        finally { observerStop.Dispose(); stop.Dispose(); }
    }
}
