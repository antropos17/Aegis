using System;
using System.Runtime.InteropServices;

namespace Aegis.ProtectedSession
{
    // Production always creates HvSocketNative. Substitutions are test-only.
    internal interface IHvSocketIo
    {
        void Open();
        int Connect(byte[] address);
        int Wait(bool read, bool write, int milliseconds);
        int Error();
        byte[] Peer();
        int Receive(byte[] bytes, int offset, int count, out int error);
        int Send(byte[] bytes, int offset, int count, out int error);
        void Close();
    }

    internal sealed class HvSocketNative : IHvSocketIo
    {
        private IntPtr handle = new IntPtr(-1);
        private bool started, opened, closed;
        [StructLayout(LayoutKind.Sequential)]
        private struct TimeValue { internal int Seconds, Microseconds; }
        // Windows x64 fd_set: uint count, four bytes alignment, then UINT_PTR.
        [StructLayout(LayoutKind.Sequential)]
        private struct DescriptorSet { internal uint Count; internal UIntPtr Socket; }

        [DllImport("ws2_32.dll", ExactSpelling = true)]
        private static extern int WSAStartup(ushort version, [Out] byte[] data);
        [DllImport("ws2_32.dll", ExactSpelling = true)] private static extern int WSACleanup();
        [DllImport("ws2_32.dll", ExactSpelling = true)] private static extern int WSAGetLastError();
        [DllImport("ws2_32.dll", ExactSpelling = true)]
        private static extern IntPtr WSASocketW(int family, int type, int protocol, IntPtr information, uint group, uint flags);
        [DllImport("ws2_32.dll", ExactSpelling = true)] private static extern int ioctlsocket(IntPtr value, int command, ref uint argument);
        [DllImport("ws2_32.dll", ExactSpelling = true)] private static extern int connect(IntPtr value, byte[] address, int length);
        [DllImport("ws2_32.dll", ExactSpelling = true)]
        private static extern int select(int ignored, IntPtr read, IntPtr write, IntPtr error, ref TimeValue timeout);
        [DllImport("ws2_32.dll", ExactSpelling = true)]
        private static extern int getsockopt(IntPtr value, int level, int name, out int result, ref int length);
        [DllImport("ws2_32.dll", ExactSpelling = true)] private static extern int getpeername(IntPtr value, [Out] byte[] address, ref int length);
        [DllImport("ws2_32.dll", ExactSpelling = true)] private static extern int recv(IntPtr value, [Out] byte[] bytes, int length, int flags);
        [DllImport("ws2_32.dll", ExactSpelling = true)] private static extern int send(IntPtr value, byte[] bytes, int length, int flags);
        [DllImport("ws2_32.dll", ExactSpelling = true)] private static extern int closesocket(IntPtr value);

        private static InvalidOperationException Unavailable() { return new InvalidOperationException("hv-native-unavailable"); }
        private void RequireOpen() { if (!opened || closed || handle == new IntPtr(-1)) throw Unavailable(); }
        public void Open()
        {
            if (opened || started || closed || IntPtr.Size != 8) throw Unavailable();
            byte[] data = new byte[512];
            try
            {
                if (WSAStartup(0x0202, data) != 0) throw Unavailable();
                started = true;
                if (data[0] != 2 || data[1] != 2) throw Unavailable();
                // WSA_FLAG_NO_HANDLE_INHERIT: later child creation cannot inherit it.
                handle = WSASocketW(34, 1, 1, IntPtr.Zero, 0, 0x80);
                if (handle == new IntPtr(-1)) throw Unavailable();
                uint nonblocking = 1;
                if (ioctlsocket(handle, unchecked((int)0x8004667e), ref nonblocking) != 0) throw Unavailable();
                opened = true;
            }
            finally { Array.Clear(data, 0, data.Length); }
        }
        public int Connect(byte[] address)
        {
            RequireOpen();
            if (address == null || address.Length != 36) throw Unavailable();
            return connect(handle, address, address.Length) == 0 ? 0 : WSAGetLastError();
        }
        private static IntPtr MakeSet(IntPtr value)
        {
            var set = new DescriptorSet { Count = 1, Socket = new UIntPtr(unchecked((ulong)value.ToInt64())) };
            IntPtr memory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(DescriptorSet)));
            Marshal.StructureToPtr(set, memory, false); return memory;
        }
        public int Wait(bool read, bool write, int milliseconds)
        {
            RequireOpen();
            if ((!read && !write) || milliseconds < 1 || milliseconds > 20) throw Unavailable();
            IntPtr readers = IntPtr.Zero, writers = IntPtr.Zero, errors = IntPtr.Zero;
            try
            {
                if (read) readers = MakeSet(handle);
                if (write) writers = MakeSet(handle);
                errors = MakeSet(handle);
                var timeout = new TimeValue { Seconds = 0, Microseconds = milliseconds * 1000 };
                int result = select(0, readers, writers, errors, ref timeout);
                if (result < 0) throw Unavailable();
                int ready = 0;
                if (readers != IntPtr.Zero && Marshal.ReadInt32(readers) != 0) ready |= 1;
                if (writers != IntPtr.Zero && Marshal.ReadInt32(writers) != 0) ready |= 2;
                if (Marshal.ReadInt32(errors) != 0) ready |= 4;
                return ready;
            }
            finally
            {
                if (readers != IntPtr.Zero) Marshal.FreeHGlobal(readers);
                if (writers != IntPtr.Zero) Marshal.FreeHGlobal(writers);
                if (errors != IntPtr.Zero) Marshal.FreeHGlobal(errors);
            }
        }
        public int Error()
        {
            RequireOpen(); int value, length = 4;
            if (getsockopt(handle, 0xffff, 0x1007, out value, ref length) != 0 || length != 4) throw Unavailable();
            return value;
        }
        public byte[] Peer()
        {
            RequireOpen(); byte[] address = new byte[36]; int length = address.Length;
            if (getpeername(handle, address, ref length) != 0 || length != address.Length) throw Unavailable();
            return address;
        }
        private int Transfer(byte[] bytes, int offset, int count, bool writing, out int error)
        {
            RequireOpen();
            if (bytes == null || offset < 0 || count < 1 || count > 4096 || offset > bytes.Length - count) throw Unavailable();
            byte[] part = new byte[count];
            try
            {
                if (writing) Buffer.BlockCopy(bytes, offset, part, 0, count);
                int result = writing ? send(handle, part, count, 0) : recv(handle, part, count, 0);
                error = result < 0 ? WSAGetLastError() : 0;
                if (result > count) throw Unavailable();
                if (!writing && result > 0) Buffer.BlockCopy(part, 0, bytes, offset, result);
                return result;
            }
            finally { Array.Clear(part, 0, part.Length); }
        }
        public int Receive(byte[] bytes, int offset, int count, out int error) { return Transfer(bytes, offset, count, false, out error); }
        public int Send(byte[] bytes, int offset, int count, out int error) { return Transfer(bytes, offset, count, true, out error); }
        public void Close()
        {
            if (closed) return;
            closed = true; bool failed = false;
            if (handle != new IntPtr(-1))
            {
                IntPtr original = handle; handle = new IntPtr(-1);
                if (closesocket(original) != 0) failed = true;
            }
            if (started) { started = false; if (WSACleanup() != 0) failed = true; }
            if (failed) throw Unavailable();
        }
    }
}
