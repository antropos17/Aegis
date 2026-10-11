using System;
using System.Runtime.InteropServices;
using Aegis.ProtectedSession;

namespace Aegis.InstalledOwner
{
    internal static class OwnerProgram
    {
        private delegate void ServiceMain(uint count, IntPtr arguments);
        private delegate uint Handler(uint control, uint kind, IntPtr data, IntPtr context);
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Table
        { [MarshalAs(UnmanagedType.LPWStr)] internal string Name; internal ServiceMain Main; }
        [StructLayout(LayoutKind.Sequential)] private struct Status
        { internal uint Type, State, Accepted, Win32Exit, ServiceExit, Checkpoint, Wait; }
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool StartServiceCtrlDispatcher(Table[] table);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr RegisterServiceCtrlHandlerEx(string name, Handler handler, IntPtr context);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool SetServiceStatus(IntPtr handle, ref Status status);
        private static readonly ServiceMain MainCallback = Run;
        private static readonly Handler ControlCallback = Control;
        private static IntPtr statusHandle;
        private static InstalledOwnerRuntime runtime;
        private static int Main(string[] arguments)
        {
            if (arguments.Length != 0) return 2;
            try { return StartServiceCtrlDispatcher(new[] { new Table { Name = InstalledOwnerPolicy.ServiceName, Main = MainCallback }, new Table() }) ? 0 : 2; }
            catch { return 2; }
        }
        private static void Report(uint state, uint code)
        {
            var status = new Status { Type = 0x10, State = state, Accepted = state == 4 ? 1U : 0U, Win32Exit = code, Wait = state == 3 ? 16000U : 0U };
            CallerNative.Require(SetServiceStatus(statusHandle, ref status));
        }
        private static void Run(uint count, IntPtr arguments)
        {
            try
            {
                CallerNative.Require(count == 1);
                statusHandle = RegisterServiceCtrlHandlerEx(InstalledOwnerPolicy.ServiceName, ControlCallback, IntPtr.Zero);
                CallerNative.Require(statusHandle != IntPtr.Zero); Report(2, 0);
                runtime = new InstalledOwnerRuntime(); var deadline = new InstalledOwnerDeadline(12000); Report(4, 0);
                // Bounded SCM observation interval, included in the same total attempt budget.
                System.Threading.Thread.Sleep(250);
                bool completed = runtime.Run(deadline); Report(1, completed ? 0U : 1U);
            }
            catch { if (runtime != null) runtime.Dispose(); if (statusHandle != IntPtr.Zero) try { Report(1, 1); } catch { } }
        }
        private static uint Control(uint control, uint kind, IntPtr data, IntPtr context)
        {
            if (control != 1) return 120;
            try { Report(3, 0); if (runtime != null) runtime.Dispose(); return 0; }
            catch { return 1; }
        }
    }
}
