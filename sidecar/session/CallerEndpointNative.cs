using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal static class CallerEndpointNative
    {
        internal const uint ClientRights = 0x00100182; // data write, attributes, synchronize; no instance-create
        internal const uint ServerRights = 0x001f01ff;
        [StructLayout(LayoutKind.Sequential)]
        internal struct SecurityAttributes
        { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern SafeFileHandle CreateNamedPipe(string name, uint open, uint mode,
            uint instances, uint output, uint input, uint timeout, ref SecurityAttributes security);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern SafeFileHandle CreateFile(string name, uint access, uint share,
            IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool ConnectNamedPipe(SafeFileHandle pipe, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool DisconnectNamedPipe(SafeFileHandle pipe);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool SetNamedPipeHandleState(SafeFileHandle pipe, ref uint mode, IntPtr count, IntPtr timeout);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool GetHandleInformation(SafeHandle handle, out uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool WriteFile(SafeHandle pipe, byte[] bytes, uint length, out uint written, IntPtr overlapped);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,
            uint revision, out IntPtr descriptor, out uint bytes);
        [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr memory);
        [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();

        internal static string LogonSid(SafeFileHandle token)
        {
            int size;
            CallerNative.GetTokenInformation(token, 2, IntPtr.Zero, 0, out size);
            CallerNative.Require(size >= 8 && size <= 65536 && Marshal.GetLastWin32Error() == 122);
            IntPtr buffer = Marshal.AllocHGlobal((int)size);
            try
            {
                int returned;
                CallerNative.Require(CallerNative.GetTokenInformation(token, 2, buffer, size, out returned) && returned <= size);
                int count = Marshal.ReadInt32(buffer), offset = IntPtr.Size == 8 ? 8 : 4;
                int stride = IntPtr.Size == 8 ? 16 : 8;
                CallerNative.Require(count >= 0 && count <= (returned - offset) / stride);
                string found = null;
                for (int i = 0; i < count; i++)
                {
                    IntPtr entry = IntPtr.Add(buffer, offset + i * stride);
                    uint attributes = unchecked((uint)Marshal.ReadInt32(entry, IntPtr.Size));
                    if ((attributes & 0xc0000000) != 0xc0000000) continue;
                    CallerNative.Require(found == null && (attributes & 4) != 0 && (attributes & 16) == 0);
                    IntPtr sid = Marshal.ReadIntPtr(entry);
                    long relative = sid.ToInt64() - buffer.ToInt64();
                    CallerNative.Require(relative >= 0 && relative + 8 <= returned);
                    int length = 8 + 4 * Marshal.ReadByte(sid, 1);
                    CallerNative.Require(relative + length <= returned);
                    found = new SecurityIdentifier(sid).Value;
                }
                CallerNative.Require(found != null);
                return found;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        internal static SafeFileHandle Create(string name, string serverLogon, string peerLogon)
        {
            // Native token SIDs only. Same-logon callers share OS rights; retained admission still fences the process.
            string dacl = "D:P(A;;0x001f01ff;;;" + serverLogon + ")";
            if (serverLogon != peerLogon) dacl += "(A;;0x00100182;;;" + peerLogon + ")";
            IntPtr descriptor; uint bytes;
            CallerNative.Require(ConvertStringSecurityDescriptorToSecurityDescriptor(dacl, 1, out descriptor, out bytes));
            try
            {
                var security = new SecurityAttributes {
                    Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = descriptor, Inherit = 0
                };
                var pipe = CreateNamedPipe(name, 1 | 0x00080000, 4 | 2 | 1 | 8, 1, 0, 8192, 2000, ref security);
                if (pipe.IsInvalid) {
                    int error = Marshal.GetLastWin32Error(); pipe.Dispose();
                    throw new InvalidOperationException("caller-endpoint-create-denied:" + error);
                }
                try { RequireNonInherited(pipe); return pipe; }
                catch { pipe.Dispose(); throw; }
            }
            finally { LocalFree(descriptor); }
        }

        internal static void RequireNonInherited(SafeHandle handle)
        {
            uint flags;
            CallerNative.Require(GetHandleInformation(handle, out flags) && (flags & 1) == 0);
        }
    }
}
