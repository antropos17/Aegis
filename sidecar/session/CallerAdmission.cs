using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Single complete message per connection. The caller owns and closes the
    // pipe after this call; this primitive never dispatches a privileged effect.
    internal static class CallerAdmission
    {
        private const int MaxFrameBytes = 4096;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly Regex Schema = new Regex(
            "\\A\\{\"protocol\":\"aegis-supervisor-caller\",\"version\":1," +
            "\"operation\":\"inspect-owned\",\"requestId\":\"([a-f0-9]{32})\"," +
            "\"sessionId\":\"([a-f0-9]{32})\",\"generation\":\"([a-f0-9]{32})\",\"sequence\":1\\}\\z",
            RegexOptions.CultureInvariant);
        private static readonly Regex MainSchema = new Regex(
            "\\A\\{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"role\":\"controller-main\"," +
            "\"operation\":\"inspect-owned\",\"requestId\":\"([a-f0-9]{32})\",\"sessionId\":\"([a-f0-9]{32})\"," +
            "\"generation\":\"([a-f0-9]{32})\",\"selectionId\":\"([a-f0-9]{32})\",\"inventoryRevision\":([1-9][0-9]{0,9})," +
            "\"selectionEpoch\":\"([a-f0-9]{32})\",\"sequence\":1\\}\\z", RegexOptions.CultureInvariant);

        internal sealed class Context
        {
            private readonly CallerRegistration registration;
            private readonly SafeHandle pipe;
            private readonly Stopwatch lease = Stopwatch.StartNew();
            internal readonly string RequestId;
            internal readonly string SelectionId, SelectionEpoch;
            internal readonly uint InventoryRevision;
            internal Context(CallerRegistration owner, SafeHandle connection, Match frame)
            {
                registration = owner; pipe = connection; RequestId = frame.Groups[1].Value;
                if (frame.Groups.Count > 4)
                {
                    SelectionId = frame.Groups[4].Value; SelectionEpoch = frame.Groups[6].Value;
                    CallerNative.Require(UInt32.TryParse(frame.Groups[5].Value, out InventoryRevision));
                }
            }
            // No serialized context or booleans can substitute for this live fence.
            internal void CheckCurrent()
            {
                lock (registration.Gate)
                {
                    // Admission reverts its own impersonation, but the invoking
                    // thread may have acquired another token before this fence.
                    CallerNative.Require(!CallerNative.HasThreadToken());
                    CallerNative.Require(!pipe.IsClosed && lease.ElapsedMilliseconds < 2000);
                    uint peer, available, left;
                    CallerNative.Require(CallerNative.GetNamedPipeClientProcessId(pipe, out peer));
                    registration.CheckLive(peer);
                    CallerNative.Require(CallerNative.PeekNamedPipe(pipe, IntPtr.Zero, 0, IntPtr.Zero,
                        out available, out left) && available == 0);
                    CallerNative.Require(!CallerNative.HasThreadToken());
                }
            }
        }

        internal static Context ReadAndAuthenticate(SafeHandle pipe, CallerRegistration registered, CallerNative native)
        { int substage = 0; return Authenticate(pipe, registered, native, Schema, ref substage); }
        internal static Context ReadMainAndAuthenticate(SafeHandle pipe, CallerRegistration registered, CallerNative native)
        { int substage = 0; return ReadMainAndAuthenticate(pipe, registered, native, ref substage); }
        internal static Context ReadMainAndAuthenticate(SafeHandle pipe, CallerRegistration registered, CallerNative native, ref int substage)
        { return Authenticate(pipe, registered, native, MainSchema, ref substage); }
        private static Context Authenticate(SafeHandle pipe, CallerRegistration registered, CallerNative native, Regex schema, ref int substage)
        {
            lock (registered.Gate)
            {
                substage = 20; CallerNative.Require(!CallerNative.HasThreadToken());
                substage = 21; registered.CheckCurrent();
                substage = 4; Match frame = schema.Match(ReadMessage(pipe, ref substage));
                CallerNative.Require(frame.Success && frame.Groups[2].Value == registered.Session &&
                    frame.Groups[3].Value == registered.Generation);
                substage = 5; uint peer;
                CallerNative.Require(CallerNative.GetNamedPipeClientProcessId(pipe, out peer));
                bool impersonated = false;
                try
                {
                    impersonated = native.Impersonate(pipe);
                    CallerNative.Require(impersonated);
                    using (SafeFileHandle token = native.ThreadToken())
                        registered.CheckCaller(peer, CallerIdentity.Observe(token));
                }
                finally
                {
                    if (impersonated && !native.Revert())
                    {
                        registered.Dispose();
                        native.RevertFailure();
                        throw new InvalidOperationException("caller-reversion-failed");
                    }
                }
                substage = 6; CallerNative.Require(!CallerNative.HasThreadToken());
                registered.CheckCurrent();
                uint available, left;
                CallerNative.Require(CallerNative.PeekNamedPipe(pipe, IntPtr.Zero, 0, IntPtr.Zero, out available, out left) && available == 0);
                return new Context(registered, pipe, frame);
            }
        }

        private static string ReadMessage(SafeHandle pipe, ref int substage)
        {
            uint state;
            CallerNative.Require(CallerNative.GetNamedPipeHandleState(pipe, out state, IntPtr.Zero,
                IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0) && (state & 2) != 0);
            Stopwatch timer = Stopwatch.StartNew();
            uint available, left;
            do
            {
                CallerNative.Require(CallerNative.PeekNamedPipe(pipe, IntPtr.Zero, 0, IntPtr.Zero, out available, out left));
                if (available > 0) break;
                if (timer.ElapsedMilliseconds >= 2000)
                { substage = 7; CallerNative.Require(false); }
                Thread.Sleep(2);
            } while (true);
            CallerNative.Require(left >= 5 && left <= MaxFrameBytes + 4 && available == left);
            byte[] bytes = new byte[left];
            uint read;
            CallerNative.Require(CallerNative.ReadFile(pipe, bytes, left, out read, IntPtr.Zero) && read == left);
            uint length = (uint)bytes[0] | ((uint)bytes[1] << 8) | ((uint)bytes[2] << 16) | ((uint)bytes[3] << 24);
            if (length == 0 || length > MaxFrameBytes || length != left - 4) throw new InvalidDataException();
            return Utf8.GetString(bytes, 4, (int)length);
        }
    }
}
