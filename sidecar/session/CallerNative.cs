using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // No process is opened by a wire PID. Registration duplicates an already-held handle.
    internal class CallerNative
    {
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetNamedPipeClientProcessId(SafeHandle pipe, out uint pid);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetNamedPipeServerProcessId(SafeHandle pipe, out uint pid);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint GetProcessId(SafeFileHandle process);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetProcessTimes(SafeFileHandle process, out long birth, out long exit, out long kernel, out long user);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
        [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out SafeFileHandle target, uint access, bool inherit, uint options);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(SafeFileHandle process, uint access, out SafeFileHandle token);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenThreadToken(IntPtr thread, uint access, bool openAsSelf, out SafeFileHandle token);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool ImpersonateNamedPipeClient(SafeHandle pipe);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool RevertToSelf();
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool GetTokenInformation(SafeFileHandle token, int kind, IntPtr buffer, int length, out int returned);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool PeekNamedPipe(SafeHandle pipe, IntPtr buffer, uint length, IntPtr read, out uint available, out uint left);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool ReadFile(SafeHandle pipe, byte[] buffer, uint length, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetNamedPipeHandleState(SafeHandle pipe, out uint state, IntPtr instances, IntPtr collection, IntPtr timeout, IntPtr user, uint userLength);

        internal static void Require(bool condition)
        {
            if (!condition) throw new InvalidOperationException("caller-admission-denied");
        }

        internal static SafeFileHandle Duplicate(IntPtr held)
        {
            SafeFileHandle duplicate = null;
            Require(held != IntPtr.Zero && held != new IntPtr(-1) && DuplicateHandle(
                GetCurrentProcess(), held, GetCurrentProcess(), out duplicate, 0, false, 2));
            return duplicate;
        }
        internal static SafeFileHandle DuplicateSelf()
        {
            SafeFileHandle duplicate;
            // Self is the native pseudo handle only here; imported/wire handles still reject -1.
            Require(DuplicateHandle(GetCurrentProcess(), GetCurrentProcess(), GetCurrentProcess(), out duplicate, 0, false, 2));
            return duplicate;
        }

        internal static SafeFileHandle ProcessToken(SafeFileHandle process)
        {
            SafeFileHandle token;
            Require(OpenProcessToken(process, 8, out token));
            return token;
        }

        // Virtual OS seams are only used by disposable failure-path fixtures.
        internal virtual bool Impersonate(SafeHandle pipe) { return ImpersonateNamedPipeClient(pipe); }
        internal virtual bool Revert() { return RevertToSelf(); }
        internal virtual SafeFileHandle ThreadToken()
        {
            SafeFileHandle token;
            Require(OpenThreadToken(GetCurrentThread(), 8, true, out token));
            return token;
        }
        internal virtual void RevertFailure()
        {
            // Microsoft requires process termination when reversion fails. Never return.
            Environment.FailFast("caller-reversion-failed");
        }

        internal static bool HasThreadToken()
        {
            SafeFileHandle token;
            bool opened = OpenThreadToken(GetCurrentThread(), 8, true, out token);
            int error = Marshal.GetLastWin32Error();
            if (token != null) token.Dispose();
            Require(opened || error == 1008); // ERROR_NO_TOKEN is the only safe absence.
            return opened;
        }
    }
}
