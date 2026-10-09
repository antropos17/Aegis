using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal class CallerBootstrapInput : CallerLauncherNative, IDisposable
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, IntPtr security, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
        [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int kind);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool DuplicateHandle(IntPtr sourceProcess, SafeFileHandle source, SafeFileHandle child,
            out IntPtr target, uint access, bool inherit, uint options);
        private SafeFileHandle read, write;
        private Created child;
        private bool completed, closed;
        internal override Created Create(string image)
        {
            CallerNative.Require(child == null && !closed && CreatePipe(out read, out write, IntPtr.Zero, 4096));
            try
            {
                CallerEndpointNative.RequireNonInherited(read); CallerEndpointNative.RequireNonInherited(write);
                CallerNative.Require(SetHandleInformation(read, 1, 1));
                child = CreateWithInput(image, read); return child;
            }
            finally { if (read != null) read.Dispose(); }
        }
        internal static IntPtr DuplicateServer(SafeFileHandle server, SafeFileHandle child)
        {
            IntPtr remote;
            // No SAME_ACCESS: query-limited + synchronize, no write/terminate/duplicate/token-change rights.
            CallerNative.Require(DuplicateHandle(CallerEndpointNative.GetCurrentProcess(), server, child, out remote, 0x00101000, false, 0));
            return remote;
        }
        internal void Supply(CallerRegistration server, CallerSession.RoutingLabels labels)
        {
            CallerNative.Require(!closed && !completed && child != null);
            CheckCreated(child); byte[] bytes = server.ExportBootstrap(child.Process, labels);
            uint written;
            // Fixed 144 bytes fit the private 4096-byte pipe while the sole reader is suspended.
            CallerNative.Require(CallerEndpointNative.WriteFile(write, bytes, (uint)bytes.Length, out written, IntPtr.Zero) && written == bytes.Length);
            write.Dispose(); completed = true; CheckCurrent();
        }
        internal void CheckCurrent()
        { CallerNative.Require(!closed && completed && write.IsClosed); }
        internal static CallerBootstrapFrame Receive(int timeoutMilliseconds)
        {
            CallerNative.Require(!CallerNative.HasThreadToken() && timeoutMilliseconds > 0 && timeoutMilliseconds <= 2000);
            using (var input = new SafeFileHandle(GetStdHandle(-10), true))
            {
                CallerNative.Require(!input.IsInvalid && SetHandleInformation(input, 1, 0) &&
                    GetStdHandle(-11) == new IntPtr(-1) && GetStdHandle(-12) == new IntPtr(-1));
                CallerEndpointNative.RequireNonInherited(input);
                var timer = Stopwatch.StartNew(); byte[] frame = new byte[CallerBootstrapFrame.Size]; bool received = false;
                while (true)
                {
                    if (timer.ElapsedMilliseconds >= timeoutMilliseconds) throw new TimeoutException();
                    uint available, left;
                    bool peeked = CallerNative.PeekNamedPipe(input, IntPtr.Zero, 0, IntPtr.Zero, out available, out left);
                    if (!peeked)
                    {
                        // PeekNamedPipe itself validates pipe type/read access; other handles refuse before ReadFile.
                        CallerNative.Require(Marshal.GetLastWin32Error() == 109 && received);
                        CallerNative.Require(!CallerNative.HasThreadToken());
                        return CallerBootstrapFrame.Parse(frame);
                    }
                    if (available == 0) { Thread.Sleep(2); continue; }
                    CallerNative.Require(!received && available == frame.Length);
                    uint read;
                    // Controller completes its single bounded write before release; read only the complete peeked frame.
                    CallerNative.Require(CallerNative.ReadFile(input, frame, available, out read, IntPtr.Zero) && read == available);
                    received = true;
                }
            }
        }
        public void Dispose()
        { closed = true; if (read != null) read.Dispose(); if (write != null) write.Dispose(); }
    }
}
