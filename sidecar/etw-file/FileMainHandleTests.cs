using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal static class FileMainHandleTests
{
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(SafeProcessHandle process, uint exit);
    internal static void Run(Action<string, Action> test)
    {
        void Check(bool value) { if (!value) throw new InvalidOperationException("retained-process-object"); }
        test("main-held limited process object survives exit and original handle disposal", () =>
        {
            using var owner = FileMainHandles.OpenProcess(0x101040, false, Environment.ProcessId);
            using var child = Process.Start(Program.Child("lease-test-child")) ?? throw new IOException();
            FileMainWitness? deposit = FileMainHandles.Deposit(owner, child.SafeHandle, child.Id);
            try
            {
                // A copied metadata tuple must never authorize a different object.
                bool rejected = false;
                try { using var wrong = FileMainHandles.Retrieve(owner, deposit with { birth = (ulong.Parse(deposit.birth) + 1).ToString() }); }
                catch (UnauthorizedAccessException) { rejected = true; }
                Check(rejected);
                using (var limited = FileMainHandles.Retrieve(owner, deposit))
                    Check(!TerminateProcess(limited, 77) && Marshal.GetLastWin32Error() == 5 && !FileMainHandles.Gone(limited));
                child.StandardInput.Close();
                child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8)).GetAwaiter().GetResult();
                child.Dispose();
                using var retained = FileMainHandles.Retrieve(owner, deposit);
                Check(FileMainHandles.Gone(retained) && FileMainHandles.ExitCode(retained) == 77);
            }
            finally
            {
                var release = deposit; deposit = null;
                FileMainHandles.Release(owner, release);
            }
        });
        test("private process handle and birth encodings are canonical positive integers", () =>
        {
            Check(FileMainHandles.Positive("123") == 123);
            foreach (var value in new[] { "", "0", "-1", "01", "+1", " 1", "9223372036854775808" })
            {
                bool rejected = false;
                try { FileMainHandles.Positive(value); } catch (InvalidDataException) { rejected = true; }
                Check(rejected);
            }
        });
    }
}
