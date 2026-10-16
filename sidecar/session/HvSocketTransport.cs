using System;
using System.Diagnostics;
using System.Threading;

namespace Aegis.ProtectedSession
{
    internal interface IHvSocketClock { long Milliseconds { get; } }
    internal sealed class HvSocketClock : IHvSocketClock
    {
        private readonly Stopwatch clock = Stopwatch.StartNew();
        public long Milliseconds { get { return clock.ElapsedMilliseconds; } }
    }

    // Dormant byte mechanism. No installed admission, runtime proof or commands.
    internal sealed class HvSocketTransport : IDisposable
    {
        private const int FrameMaximum = 4096, BudgetMaximum = 32768, OperationMs = 2000, LifetimeMs = 120000;
        private readonly object gate = new object();
        private readonly HvSocketEndpoint endpoint;
        private readonly IHvSocketIo io;
        private readonly IHvSocketClock clock;
        private readonly CancellationToken cancellation;
        private int stopped, used, cleanupUnknown, callbackActive;
        private bool poisoned, closeAttempted, operationBusy, registrationAssigned;
        private Timer lifetime;
        private CancellationTokenRegistration cancellationRegistration;
        private long previousTime;

        private HvSocketTransport(HvSocketEndpoint target, IHvSocketIo native, IHvSocketClock time, CancellationToken token)
        { endpoint = target; io = native; clock = time; cancellation = token; }
        internal static HvSocketTransport Connect(Guid exactVmId, CancellationToken cancellation)
        {
            var target = new HvSocketEndpoint(exactVmId);
            return ConnectCore(target, new HvSocketNative(), new HvSocketClock(), cancellation);
        }
        private static HvSocketTransport ConnectCore(HvSocketEndpoint target, IHvSocketIo native, IHvSocketClock time, CancellationToken token)
        {
            var result = new HvSocketTransport(target, native, time, token);
            lock (result.gate)
            {
                byte[] address = target.Address();
                try
                {
                    long deadline = result.Deadline(); result.Check(deadline); result.ArmLifetime(); result.Check(deadline);
                    native.Open(); result.Check(deadline);
                    int error = native.Connect(address); result.Check(deadline);
                    if (error != 0)
                    {
                        Require(error == 10035 || error == 10036 || error == 10037);
                        result.Wait(false, deadline);
                    }
                    Require(native.Error() == 0); result.Check(deadline); result.Peer(deadline);
#if HV_SOCKET_TEST
                    if (BeforeConnectUnlockForTest != null) BeforeConnectUnlockForTest(result);
#endif
                    return result;
                }
                catch { result.Fail(); throw result.Failure(); }
                finally { Array.Clear(address, 0, address.Length); }
            }
        }
        private static InvalidOperationException Unavailable() { return new InvalidOperationException("hv-transport-unavailable"); }
        private static InvalidOperationException CleanupUnknown() { return new InvalidOperationException("hv-transport-cleanup-unknown"); }
        private InvalidOperationException Failure() { return Interlocked.CompareExchange(ref cleanupUnknown, 0, 0) != 0 ? CleanupUnknown() : Unavailable(); }
        private static void Require(bool value) { if (!value) throw Unavailable(); }
        private long Now()
        {
            long value = clock.Milliseconds;
            Require(value >= previousTime && value < LifetimeMs); previousTime = value; return value;
        }
        private long Deadline() { return Math.Min(Now() + OperationMs, LifetimeMs); }
        private void Check(long deadline)
        {
            Require(!poisoned && Interlocked.CompareExchange(ref stopped, 0, 0) == 0 && !cancellation.IsCancellationRequested);
            Require(Now() < deadline);
        }
        private void Peer(long deadline)
        {
            Check(deadline); byte[] address = io.Peer();
            try { Check(deadline); endpoint.CheckPeer(address); }
            finally { if (address != null) Array.Clear(address, 0, address.Length); }
        }
        private void Wait(bool reading, long deadline)
        {
            while (true)
            {
                Check(deadline);
                int interval = (int)Math.Min(20, deadline - Now()); Require(interval > 0);
                int ready = io.Wait(reading, !reading, interval); Check(deadline);
                Require((ready & ~7) == 0);
                if ((ready & 4) != 0) { io.Error(); throw Unavailable(); }
                if ((ready & (reading ? 1 : 2)) != 0) return;
            }
        }
        private void Reserve(int length)
        { Require(length > 0 && length <= FrameMaximum && length <= BudgetMaximum - used); used += length; }
        private void Transfer(byte[] value, bool writing, long deadline)
        {
            int offset = 0;
            while (offset < value.Length)
            {
                Check(deadline); int error;
                int count = writing ? io.Send(value, offset, value.Length - offset, out error) :
                    io.Receive(value, offset, value.Length - offset, out error);
                Check(deadline);
                if (count < 0)
                {
                    Require(error == 10035); Wait(!writing, deadline); continue;
                }
                Require(error == 0 && count > 0 && count <= value.Length - offset); offset += count;
            }
        }
        internal void WriteFrame(byte[] payload)
        {
            EnterOperation();
            try
            {
                byte[] copy = null, header = null;
                try
                {
                    long deadline = Deadline(); Check(deadline);
                    Require(payload != null && payload.Length > 0 && payload.Length <= FrameMaximum);
                    copy = (byte[])payload.Clone(); Reserve(copy.Length); Peer(deadline);
                    header = new byte[] { (byte)copy.Length, (byte)(copy.Length >> 8), 0, 0 };
                    Transfer(header, true, deadline); Transfer(copy, true, deadline); Peer(deadline); Check(deadline);
                }
                catch { Fail(); throw Failure(); }
                finally
                {
                    if (copy != null) Array.Clear(copy, 0, copy.Length);
                    if (header != null) Array.Clear(header, 0, header.Length);
                }
            }
            finally { ExitOperation(); }
        }
        internal byte[] ReadFrame()
        {
            EnterOperation();
            try
            {
                byte[] payload = null, header = new byte[4]; bool returned = false;
                try
                {
                    long deadline = Deadline(); Check(deadline); Peer(deadline); Transfer(header, false, deadline);
                    uint length = (uint)header[0] | ((uint)header[1] << 8) | ((uint)header[2] << 16) | ((uint)header[3] << 24);
                    Require(length > 0 && length <= FrameMaximum); Reserve((int)length);
                    payload = new byte[(int)length]; Transfer(payload, false, deadline); Peer(deadline); Check(deadline);
                    returned = true; return payload;
                }
                catch { Fail(); throw Failure(); }
                finally
                {
                    Array.Clear(header, 0, header.Length);
                    if (!returned && payload != null) Array.Clear(payload, 0, payload.Length);
                }
            }
            finally { ExitOperation(); }
        }
        private void EnterOperation()
        {
            if (Monitor.TryEnter(gate))
            {
                if (!operationBusy) { operationBusy = true; return; }
                Monitor.Exit(gate);
            }
            SignalCancellation(); throw Unavailable();
        }
        private void Fail()
        {
            poisoned = true; Interlocked.Exchange(ref stopped, 1); CloseLocked();
        }
        private void CloseLocked()
        {
            if (closeAttempted) return;
            closeAttempted = true;
            try { if (lifetime != null) lifetime.Dispose(); } catch { Interlocked.Exchange(ref cleanupUnknown, 1); }
            // This callback only signals and changes a timer; it never waits on
            // gate, so disposing its registration under gate cannot deadlock it.
            try { if (registrationAssigned) cancellationRegistration.Dispose(); } catch { Interlocked.Exchange(ref cleanupUnknown, 1); }
            try { io.Close(); } catch { Interlocked.Exchange(ref cleanupUnknown, 1); }
        }
        private void ArmLifetime()
        {
            lifetime = new Timer(LifetimeTick, null, Timeout.Infinite, Timeout.Infinite);
            lifetime.Change((int)(LifetimeMs - Now()), 20);
            // A canceled token may invoke synchronously. The timer is published
            // first, and this gate prevents cleanup before assignment completes.
            cancellationRegistration = cancellation.Register(SignalCancellation);
            registrationAssigned = true;
        }
        private void SignalCancellation()
        {
            Interlocked.Exchange(ref stopped, 1);
            try { lifetime.Change(0, 20); }
            catch (ObjectDisposedException) { } // The original generation already retired its timer.
            catch { Interlocked.Exchange(ref cleanupUnknown, 1); }
        }
        private void LifetimeTick(object unused)
        {
            if (Interlocked.CompareExchange(ref callbackActive, 1, 0) != 0) return;
            bool entered = false;
            try
            {
                if (Interlocked.CompareExchange(ref stopped, 0, 0) == 0 && !cancellation.IsCancellationRequested && clock.Milliseconds < LifetimeMs) return;
                Interlocked.Exchange(ref stopped, 1);
                entered = Monitor.TryEnter(gate);
                // The same owned timer retries after the I/O owner releases gate,
                // including cancellation after that owner's final success check.
                if (!entered || operationBusy) return;
                poisoned = true; CloseLocked();
            }
            catch { Interlocked.Exchange(ref stopped, 1); Interlocked.Exchange(ref cleanupUnknown, 1); }
            finally { if (entered) Monitor.Exit(gate); Interlocked.Exchange(ref callbackActive, 0); }
        }
        private void ExitOperation()
        {
            try
            {
#if HV_SOCKET_TEST
                if (BeforeUnlockForTest != null) BeforeUnlockForTest();
#endif
                if (Interlocked.CompareExchange(ref stopped, 0, 0) != 0) { poisoned = true; CloseLocked(); }
            }
            finally { operationBusy = false; Monitor.Exit(gate); }
        }
        public void Dispose()
        {
            SignalCancellation();
            // Native calls are nonblocking; the I/O owner sees stop each <=20 ms wait.
            bool entered = false;
            try
            {
                entered = Monitor.TryEnter(gate, OperationMs);
                if (!entered || operationBusy) throw CleanupUnknown();
                poisoned = true; CloseLocked(); if (Interlocked.CompareExchange(ref cleanupUnknown, 0, 0) != 0) throw CleanupUnknown();
            }
            finally { if (entered) Monitor.Exit(gate); }
        }
#if HV_SOCKET_TEST
        internal static Action<HvSocketTransport> BeforeConnectUnlockForTest = null;
        internal Action BeforeUnlockForTest = null;
        internal void LifetimeTickForTest() { LifetimeTick(null); }
        internal bool StopRequestedForTest { get { return Interlocked.CompareExchange(ref stopped, 0, 0) != 0; } }
        internal static HvSocketTransport ConnectForTest(Guid vmId, IHvSocketIo io, IHvSocketClock clock, CancellationToken token)
        { return ConnectCore(new HvSocketEndpoint(vmId), io, clock, token); }
#endif
    }
}
