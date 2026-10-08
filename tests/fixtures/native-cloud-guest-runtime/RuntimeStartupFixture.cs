using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Aegis.ProtectedSession;

// Actual same-principal native console startup. No secondary logon or account changes.
internal static class RuntimeStartupFixture
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    {
        internal int Size; internal string Reserved, Desktop, Title;
        internal uint X, Y, XS, YS, XC, YC, Fill, Flags;
        internal ushort Show, Length; internal IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo
    { internal IntPtr Process, Thread; internal uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta,
        bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] private static extern uint ResumeThread(IntPtr thread);
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("startup-fixture-refused"); }
    private static bool Refused(Action action)
    { try { action(); return false; } catch (InvalidDataException) { return true; } }
    internal static void Run(string node, string root)
    {
        IntPtr job = IntPtr.Zero, environment = IntPtr.Zero;
        ProcessInfo process = new ProcessInfo(); GuestJobInventory inventory = null;
        try
        {
            using (var gate = new CloudGuestRuntimeGate(WindowsIdentity.GetCurrent().User.Value))
            {
                job = CreateJobObject(IntPtr.Zero, null); Need(job != IntPtr.Zero);
                string values = "AEGIS_CLOUD_GUEST_TASK=1\0AEGIS_RUNTIME_PIPE=" + gate.PipeName +
                    "\0AEGIS_RUNTIME_REQUEST=" + gate.Request + "\0AEGIS_RUNTIME_SESSION=" + gate.Session +
                    "\0SystemRoot=" + Environment.GetEnvironmentVariable("SystemRoot") +
                    "\0TEMP=" + root + "\0TMP=" + root + "\0\0";
                environment = Marshal.StringToHGlobalUni(values);
                var startup = new Startup(); startup.Size = Marshal.SizeOf(typeof(Startup));
                Need(CreateProcess(node, new StringBuilder("\"" + node + "\" \"" + root +
                    "/client-control.cjs\" \"" + root + "/cloud-guest-runtime.cjs\" valid"),
                    IntPtr.Zero, IntPtr.Zero, false, 0x08000404, environment, root, ref startup, out process));
                Need(AssignProcessToJobObject(job, process.Process));
                inventory = new GuestJobInventory(job, process.Process,
                    new string[] { node, Path.Combine(Environment.SystemDirectory, "conhost.exe") });
                int initial = inventory.InitialCount; long birth = GuestJobNative.Birth(process.Process, job, process.Pid);
                gate.Attach(process.Process); Need(ResumeThread(process.Thread) == 1); gate.ObserveInitialized();
                Need(!CallerNative.HasThreadToken());
                var counts = GuestJobNative.Counts(job); uint[] observed = GuestJobNative.Members(job);
                Need(counts.Total == counts.Active && counts.Active == observed.Length && observed.Length <= initial + 1);
                bool late = observed.Length > initial;
                if (late) Need(Refused(inventory.ValidateInitial));
                bool tokenRefused = false;
                foreach (uint pid in observed)
                {
                    if (pid == process.Pid) continue;
                    IntPtr handle = GuestJobNative.OpenMember(pid);
                    try
                    {
                        Need(String.Equals(GuestJobNative.Image(handle), Path.Combine(Environment.SystemDirectory, "conhost.exe"), StringComparison.OrdinalIgnoreCase));
                        Need(GuestJobNative.Principal(handle) == GuestJobNative.Principal(process.Process));
                        tokenRefused = Refused(delegate { GuestJobNative.RequireStandardPrincipal(handle,
                            GuestJobNative.Principal(process.Process), GuestJobNative.Session(process.Process)); });
                    }
                    finally { GuestJobNative.CloseHandle(handle); }
                }
                bool refused = Refused(delegate { gate.SealInitializedRuntime(inventory); });
                Need(refused == (late && tokenRefused));
                Dictionary<string, object> receipt = inventory.RuntimeStartupObservation;
                if (refused)
                {
                    Need((string)receipt["status"] == "refused" && (string)receipt["check"] == "startup-standard-token" &&
                        (bool)receipt["startupImageMatched"] && !(bool)receipt["standardStartupTokenVerified"] &&
                        inventory.InitialCount == initial);
                    bool ackRefused = false;
                    try { gate.ReleaseFixedTask(inventory); } catch (InvalidOperationException) { ackRefused = true; }
                    Need(ackRefused);
                }
                else
                {
                    inventory.ValidateInitial(); Need(GuestJobNative.Birth(process.Process, job, process.Pid) == birth);
                    gate.ReleaseFixedTask(inventory); Need(GuestJobNative.WaitForSingleObject(process.Process, 3000) == 0);
                }
                Console.WriteLine("native-console-census:initial=" + initial + ",ready=" + observed.Length +
                    ",lateConhost=" + late + ",standardTokenRefused=" + tokenRefused + ",sealRefused=" + refused);
            }
        }
        finally
        {
            if (job != IntPtr.Zero)
            {
                Need(TerminateJobObject(job, 137));
                if (inventory != null) { Need(inventory.ConfirmClosure(2000)); inventory.Dispose(); }
                GuestJobNative.CloseHandle(job);
            }
            if (process.Process != IntPtr.Zero) GuestJobNative.CloseHandle(process.Process);
            if (process.Thread != IntPtr.Zero) GuestJobNative.CloseHandle(process.Thread);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        }
    }
    internal static void TokenControls()
    {
        // Synthetic TOKEN_GROUPS buffers decoded through the actual native helper.
        for (int mode = 0; mode < 13; mode++)
        {
            IntPtr data = Marshal.AllocHGlobal(128);
            try
            {
                for (int at = 0; at < 128; at++) Marshal.WriteByte(data, at, 0);
                int offset = IntPtr.Size, stride = IntPtr.Size == 8 ? 16 : 8, length = 128;
                Marshal.WriteInt32(data, mode == 10 ? 2 : 1);
                var sid = new SecurityIdentifier(mode == 0 ? WellKnownSidType.WorldSid : WellKnownSidType.BuiltinAdministratorsSid, null);
                var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0); Marshal.Copy(bytes, 0, IntPtr.Add(data, 64), bytes.Length);
                Marshal.WriteIntPtr(data, offset, IntPtr.Add(data, 64));
                Marshal.WriteInt32(data, offset + IntPtr.Size, mode == 2 ? 16 : mode == 3 ? 0 : 4);
                if (mode == 4) Marshal.WriteIntPtr(data, offset, IntPtr.Zero);
                if (mode == 5) Marshal.WriteIntPtr(data, offset, IntPtr.Add(data, 128));
                if (mode == 6) Marshal.WriteByte(data, 64, 2);
                if (mode == 7) Marshal.WriteByte(data, 65, 255);
                if (mode == 8) Marshal.WriteInt32(data, 257);
                if (mode == 9) length = offset + stride - 1;
                if (mode == 10) Marshal.WriteIntPtr(data, offset + stride, IntPtr.Zero);
                if (mode == 11) { Marshal.WriteInt32(data, 0); length = 4; }
                if (mode == 12) Marshal.WriteIntPtr(data, offset, IntPtr.Add(data, offset));
                Need(Refused(delegate { GuestJobNative.RequireNoAdministratorGroups(data, length); }) == (mode != 0 && mode != 11));
            }
            finally { Marshal.FreeHGlobal(data); }
        }
        using (var process = System.Diagnostics.Process.GetCurrentProcess())
            Need(Refused(delegate { GuestJobNative.RequireStandardPrincipal(process.Handle, "S-1-5-7", GuestJobNative.Session(process.Handle)); }));
        Console.WriteLine("synthetic-startup-token-groups:13"); Console.WriteLine("native-wrong-startup-principal:1");
    }
}
