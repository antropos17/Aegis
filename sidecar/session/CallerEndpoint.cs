using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Internal owned endpoint primitive. Installation and trusted locator/registration delivery remain separate gates.
    internal sealed class CallerEndpoint : IDisposable
    {
        private readonly object gate = new object();
        private readonly CallerRegistration peer;
        private readonly SafeFileHandle pipe;
        private bool consumed, disposed;
        internal readonly string LocalLocator;

        internal CallerEndpoint(CallerRegistration registration, IntPtr heldPeerProcess)
        {
            peer = registration;
            CallerNative.Require(!CallerNative.HasThreadToken());
            using (var held = CallerNative.Duplicate(heldPeerProcess))
            using (var token = CallerNative.ProcessToken(held))
            using (var current = Process.GetCurrentProcess())
            using (var selfProcess = CallerNative.Duplicate(current.Handle))
            using (var self = CallerNative.ProcessToken(selfProcess))
            {
                lock (peer.Gate)
                {
                    peer.CheckLive(CallerNative.GetProcessId(held));
                    CallerNative.Require(CallerIdentity.Observe(self).PermittedBroker());
                    LocalLocator = "\\\\.\\pipe\\aegis-owned-caller-" + Guid.NewGuid().ToString("N");
                    pipe = CallerEndpointNative.Create(LocalLocator, CallerEndpointNative.LogonSid(self), CallerEndpointNative.LogonSid(token));
                }
            }
        }

        internal CallerAdmission.Context Accept(int timeoutMilliseconds)
        { return AcceptCore(timeoutMilliseconds, false); }
        internal CallerAdmission.Context AcceptMain(int timeoutMilliseconds)
        { return AcceptCore(timeoutMilliseconds, true); }
        private CallerAdmission.Context AcceptCore(int timeoutMilliseconds, bool main)
        {
            RequireDeadline(timeoutMilliseconds);
            lock (gate)
            {
                CallerNative.Require(!disposed && !consumed);
                consumed = true;
                var timer = Stopwatch.StartNew();
                try
                {
                    while (true)
                    {
                        lock (peer.Gate) peer.CheckCurrent();
                        bool result = CallerEndpointNative.ConnectNamedPipe(pipe, IntPtr.Zero);
                        int error = result ? 0 : Marshal.GetLastWin32Error();
                        // In NOWAIT mode TRUE means listening, not connected. Only 535 admits the connection.
                        if (!result && error == 535) break;
                        CallerNative.Require(result || error == 536);
                        if (timer.ElapsedMilliseconds >= timeoutMilliseconds) throw new TimeoutException("caller-endpoint-connect-deadline");
                        Thread.Sleep(2);
                    }
                    // Keep NOWAIT: no pending native IO, and the existing admission reads one already-peeked message.
                    return main ? CallerAdmission.ReadMainAndAuthenticate(pipe, peer, new CallerNative()) :
                        CallerAdmission.ReadAndAuthenticate(pipe, peer, new CallerNative());
                }
                catch { Close(); throw; }
            }
        }

        // A composition fence, without consuming a connection or supplying authority.
        internal void CheckCurrent()
        {
            lock (gate)
            lock (peer.Gate)
            {
                CallerNative.Require(!CallerNative.HasThreadToken() && !disposed &&
                    !pipe.IsClosed && !pipe.IsInvalid);
                CallerEndpointNative.RequireNonInherited(pipe);
                peer.CheckCurrent();
                CallerNative.Require(!CallerNative.HasThreadToken());
            }
        }

        internal static SafeFileHandle ConnectLocal(string locator, CallerRegistration expectedServer, int timeoutMilliseconds)
        {
            RequireDeadline(timeoutMilliseconds);
            CallerNative.Require(locator != null && locator.Length == "\\\\.\\pipe\\aegis-owned-caller-".Length + 32 && Regex.IsMatch(locator,
                "\\A\\\\\\\\\\.\\\\pipe\\\\aegis-owned-caller-[a-f0-9]{32}\\z", RegexOptions.CultureInvariant));
            var timer = Stopwatch.StartNew();
            while (true)
            {
                lock (expectedServer.Gate) expectedServer.CheckCurrent();
                var client = CallerEndpointNative.CreateFile(locator, CallerEndpointNative.ClientRights,
                    0, IntPtr.Zero, 3, 0x00100000 | 0x00020000, IntPtr.Zero);
                if (!client.IsInvalid)
                {
                    try
                    {
                        CallerEndpointNative.RequireNonInherited(client);
                        expectedServer.VerifyServer(client);
                        uint mode = 1; // nonblocking writes; byte read mode unused by the one-way protocol
                        CallerNative.Require(CallerEndpointNative.SetNamedPipeHandleState(client, ref mode, IntPtr.Zero, IntPtr.Zero));
                        return client;
                    }
                    catch { client.Dispose(); throw; }
                }
                int error = Marshal.GetLastWin32Error(); client.Dispose();
                CallerNative.Require(error == 2 || error == 231);
                if (timer.ElapsedMilliseconds >= timeoutMilliseconds) throw new TimeoutException("caller-endpoint-client-deadline");
                Thread.Sleep(2);
            }
        }

        private static void RequireDeadline(int milliseconds)
        { CallerNative.Require(milliseconds > 0 && milliseconds <= 2000); }
        private void Close()
        {
            if (disposed) return;
            disposed = true;
            // No flush, reconnection or asynchronous operation; close invalidates every returned context.
            CallerEndpointNative.DisconnectNamedPipe(pipe);
            pipe.Dispose();
        }
        public void Dispose() { lock (gate) Close(); }
    }
}
