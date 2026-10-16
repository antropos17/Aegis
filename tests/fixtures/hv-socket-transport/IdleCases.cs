#if HV_SOCKET_TEST
using System;
using System.Threading;
using Aegis.ProtectedSession;

internal static class IdleCases
{
    private static void Check(bool value) { Cases.Check(value); }
    internal static void Run(string mode)
    {
        if (mode == "register-cancelled") { CancelDuringRegistration(); return; }
        var io = new ModeledSocket(); var cancellation = new CancellationTokenSource();
        using (var closed = new ManualResetEvent(false))
        {
            io.OnClose = delegate { closed.Set(); };
            if (mode == "connect-gap")
            {
                HvSocketTransport.BeforeConnectUnlockForTest = delegate { cancellation.Cancel(); };
                var gap = Cases.Open(io, cancellation.Token);
                Check(closed.WaitOne(1000) && io.Closes == 1 && io.Transfers == 0);
                gap.Dispose(); return;
            }
            var connection = Cases.Open(io, cancellation.Token);
            if (mode == "cancel") cancellation.Cancel();
            else if (mode == "expire") { io.Clock.Value = 120000; connection.LifetimeTickForTest(); }
            else if (mode == "frame-gap" || mode == "read-frame-gap")
            {
                connection.BeforeUnlockForTest = delegate
                {
                    connection.BeforeUnlockForTest = null; cancellation.Cancel(); connection.LifetimeTickForTest();
                    Check(io.Closes == 0); // A busy native/frame owner is never closed by a callback.
                };
                if (mode == "frame-gap")
                {
                    Cases.Refuses(delegate { connection.WriteFrame(new byte[] { 82 }); });
                    Cases.Equal(io.Output.ToArray(), Cases.Frame(new byte[] { 82 }));
                }
                else
                {
                    io.Input = Cases.Frame(new byte[] { 7, 8, 9 });
                    Cases.Refuses(delegate { connection.ReadFrame(); });
                }
                Cases.Cleared(io);
            }
            else if (mode == "native-reentry")
            {
                io.OnTransfer = delegate
                {
                    io.OnTransfer = null; cancellation.Cancel(); connection.LifetimeTickForTest(); Check(io.Closes == 0);
                };
                Cases.Refuses(delegate { connection.WriteFrame(new byte[] { 82 }); });
            }
            else if (mode == "close-unknown")
            {
                io.CloseFails = true; cancellation.Cancel();
            }
            else if (mode == "dispose-race")
            {
                Exception cancellationFailure = null;
                var signal = new Thread(delegate() { try { cancellation.Cancel(); } catch (Exception failure) { cancellationFailure = failure; } });
                signal.IsBackground = true; signal.Start(); connection.Dispose(); Check(signal.Join(1000) && cancellationFailure == null);
            }
            else throw new InvalidOperationException("fixture-idle-mode");
            // Cleanup is observed before any following ReadFrame/WriteFrame or Dispose.
            Check(closed.WaitOne(1000) && io.Closes == 1 && io.Opens == 1);
            if (mode == "cancel" || mode == "expire" || mode == "close-unknown" || mode == "dispose-race") Check(io.Transfers == 0);
            if (mode == "close-unknown")
            {
                bool unknown = false;
                try { connection.Dispose(); } catch (InvalidOperationException failure) { unknown = failure.Message == "hv-transport-cleanup-unknown"; }
                Check(unknown);
            }
            else connection.Dispose();
            Check(io.Closes == 1); cancellation.Dispose();
        }
    }
    private static void CancelDuringRegistration()
    {
        var io = new ModeledSocket(); var cancellation = new CancellationTokenSource(); int reads = 0;
        // Cancel after the first availability checks, before ArmLifetime registers
        // its callback. Register must safely execute an already-canceled callback.
        io.Clock.OnRead = delegate { if (++reads == 3) cancellation.Cancel(); };
        Cases.Refuses(delegate { Cases.Open(io, cancellation.Token); });
        Check(io.Closes == 1 && io.Opens == 0); cancellation.Dispose();
    }
}
#endif
