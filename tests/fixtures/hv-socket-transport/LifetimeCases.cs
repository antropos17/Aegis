#if HV_SOCKET_TEST
using System;
using System.Threading;
using Aegis.ProtectedSession;

internal static class LifetimeCases
{
    private static void Check(bool value) { Cases.Check(value); }
    internal static void Run(string change)
    {
        if (change == "overlap" || change == "dispose-overlap") { Overlap(change == "dispose-overlap"); return; }
        var io = new ModeledSocket(); var cancellation = new CancellationTokenSource();
        var connection = Cases.Open(io, cancellation.Token);
        if (change == "budget-write" || change == "budget-read" || change == "budget-mixed")
        {
            for (int count = 0; count < 8; count++)
            {
                if (change == "budget-write" || (change == "budget-mixed" && count % 2 == 0)) connection.WriteFrame(new byte[4096]);
                else { io.Input = Cases.Frame(new byte[4096]); io.Position = 0; Cases.Equal(connection.ReadFrame(), new byte[4096]); }
            }
            int calls = io.Transfers, sent = io.Output.Count;
            Cases.Refuses(delegate { connection.WriteFrame(new byte[] { 1 }); });
            Check(io.Transfers == calls && io.Output.Count == sent); Cases.Terminal(connection, io); return;
        }
        if (change == "dispose")
        {
            connection.Dispose(); Cases.Terminal(connection, io); Check(io.Transfers == 0); return;
        }
        if (change == "close-unknown")
        {
            io.CloseFails = true; CleanupUnknown(connection.Dispose); Cases.Terminal(connection, io); return;
        }
        if (change == "connect-cleanup-unknown")
        {
            connection.Dispose(); io = new ModeledSocket { ConnectError = 10061, CloseFails = true };
            CleanupUnknown(delegate { Cases.Open(io); }); Check(io.Closes == 1 && io.Opens == 1); return;
        }
        if (change == "frame-cleanup-unknown")
        {
            io.CloseFails = true; io.SendZero = true;
            CleanupUnknown(delegate { connection.WriteFrame(new byte[] { 1 }); }); Cases.Terminal(connection, io); return;
        }
        if (change == "reentry")
        {
            int reentries = 0;
            io.OnTransfer = delegate
            {
                io.OnTransfer = null; reentries++;
                Cases.Refuses(delegate { connection.WriteFrame(new byte[] { 99 }); });
            };
            Cases.Refuses(delegate { connection.WriteFrame(new byte[] { 1 }); });
            Check(reentries == 1 && io.Transfers == 1 && io.Output.Count <= 4); Cases.Terminal(connection, io); return;
        }
        if (change == "dispose-reentry")
        {
            io.OnTransfer = delegate { io.OnTransfer = null; CleanupUnknown(connection.Dispose); Check(io.Closes == 0); };
            Cases.Refuses(delegate { connection.WriteFrame(new byte[] { 1 }); }); Cases.Terminal(connection, io); return;
        }
        if (change == "cancel-before-frame") cancellation.Cancel();
        else if (change == "cancel-wait") { io.WouldBlockWrites = 1; io.OnWait = cancellation.Cancel; }
        else if (change == "cancel-header") io.OnTransfer = cancellation.Cancel;
        else if (change == "cancel-body") io.OnTransfer = delegate { if (io.Transfers == 2) cancellation.Cancel(); };
        else if (change == "cancel-after-frame") io.OnPeer = delegate { if (io.PeerReads == 3) cancellation.Cancel(); };
        else if (change == "cancel-read-header") { io.Input = Cases.Frame(new byte[] { 1 }); io.OnTransfer = cancellation.Cancel; }
        else if (change == "cancel-read-body") { io.Input = Cases.Frame(new byte[] { 1 }); io.OnTransfer = delegate { if (io.Transfers == 2) cancellation.Cancel(); }; }
        else if (change == "drip-read") { io.Input = Cases.Frame(new byte[20]); io.Chunk = 1; io.TransferMilliseconds = 100; }
        else if (change == "drip-write") { io.Chunk = 1; io.TransferMilliseconds = 100; }
        else if (change == "lifetime") io.Clock.Value = 120000;
        else if (change == "clock-backward") { io.Clock.Value = 5; connection.WriteFrame(new byte[] { 1 }); io.Clock.Value = 4; }
        else if (change == "expires-peer") io.OnPeer = delegate { if (io.PeerReads == 3) io.Clock.Value = 2000; };
        else if (change == "wait-error") { io.WouldBlockWrites = 1; io.Ready = 4; }
        else if (change == "wait-no-ready") { io.WouldBlockWrites = 1; io.Ready = 0; }
        else if (change == "wait-invalid") { io.WouldBlockWrites = 1; io.Ready = 8; }
        else if (change == "restore-peer") { io.PeerChangeAt = 2; }
        else throw new InvalidOperationException("fixture-lifetime-case");
        if (change == "drip-read" || change == "cancel-read-header" || change == "cancel-read-body")
            Cases.Refuses(delegate { connection.ReadFrame(); });
        else Cases.Refuses(delegate { connection.WriteFrame(new byte[20]); });
        if (change == "drip-read" || change == "drip-write") Check(io.Clock.Value == 2000);
        if (change == "cancel-before-frame" || change == "lifetime") Check(io.Transfers == 0);
        if (change == "cancel-wait") Check(io.Output.Count == 0 && io.Waits == 1);
        if (change == "restore-peer") { io.PeerChangeAt = -1; }
        Cases.Cleared(io); Cases.Terminal(connection, io); cancellation.Dispose();
    }
    private static void CleanupUnknown(Action action)
    {
        bool unknown = false;
        try { action(); } catch (InvalidOperationException failure) { unknown = failure.Message == "hv-transport-cleanup-unknown"; }
        Check(unknown);
    }
    private static void Overlap(bool dispose)
    {
        var io = new ModeledSocket(); var connection = Cases.Open(io);
        using (var entered = new ManualResetEvent(false))
        using (var resume = new ManualResetEvent(false))
        using (var secondStarted = new ManualResetEvent(false))
        {
            io.Entered = entered; io.Continue = resume;
            bool firstRefused = false, secondFinished = false;
            Exception firstError = null, secondError = null;
            var first = new Thread(delegate()
            {
                try { Cases.Refuses(delegate { connection.WriteFrame(new byte[4096]); }); firstRefused = true; }
                catch (Exception failure) { firstError = failure; }
            });
            var second = new Thread(delegate()
            {
                secondStarted.Set();
                try { if (dispose) connection.Dispose(); else Cases.Refuses(delegate { connection.WriteFrame(new byte[4096]); }); secondFinished = true; }
                catch (Exception failure) { secondError = failure; }
            });
            first.IsBackground = true; second.IsBackground = true;
            try
            {
                first.Start(); Check(entered.WaitOne(1000)); second.Start(); Check(secondStarted.WaitOne(1000));
                if (!dispose) Check(second.Join(1000));
                // Synchronize this chosen ordering without a fixed sleep or a
                // second operation that would itself poison the connection.
                else Check(SpinWait.SpinUntil(delegate { return connection.StopRequestedForTest; }, 1000));
                resume.Set(); Check(first.Join(1000) && second.Join(1000));
                Check(firstRefused && secondFinished && firstError == null && secondError == null);
                Check(io.Opens == 1 && io.Closes == 1 && io.Transfers == 1 && io.Output.Count <= 4);
                Cases.Terminal(connection, io);
            }
            finally { resume.Set(); first.Join(1000); if ((second.ThreadState & ThreadState.Unstarted) == 0) second.Join(1000); }
        }
    }
}
#endif
