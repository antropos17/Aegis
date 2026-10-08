using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using Aegis.ProtectedSession;

// Executable lab seam: an already Job-owned guest process opens endpoints itself;
// only the three real standard handles pass to its fixed same-principal child.
internal static class CloudGuestStdioLauncher
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct Startup
    {
        internal int Size; internal string Reserved, Desktop, Title;
        internal uint X, Y, XS, YS, XC, YC, Fill, Flags;
        internal ushort Show, Length; internal IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct Extended { internal Startup Startup; internal IntPtr List; }
    [StructLayout(LayoutKind.Sequential)] internal struct Info { internal IntPtr Process, Thread; internal uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] internal struct Attributes { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")] internal static extern bool CreateExtended(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Extended startup, out Info process);
    [DllImport("kernel32.dll")] internal static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] internal static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] internal static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetNamedPipeServerProcessId(System.Runtime.InteropServices.SafeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr CreateEvent(ref Attributes attributes, bool manual, bool initial, string name);
    internal static void Need(bool value) { if (!value) throw new InvalidOperationException("stdio-fixture-refused"); }
    internal static int RunFixed(string prefix, uint ownerPid, string image, string fixedCommand, string cwd, bool testSentinel)
    {
        Need(System.Text.RegularExpressions.Regex.IsMatch(prefix, "\\Aaegis-guest-stdio-[a-f0-9]{32}\\z") && ownerPid != 0 &&
            Path.IsPathRooted(image) && Path.IsPathRooted(cwd) && fixedCommand != null && fixedCommand.Length <= 4096 && fixedCommand.IndexOf('\0') < 0);
        bool member; Need(IsProcessInJob(Process.GetCurrentProcess().Handle, IntPtr.Zero, out member) && member);
        var pipes = new NamedPipeClientStream[3]; IntPtr list = IntPtr.Zero, handles = IntPtr.Zero, sentinel = IntPtr.Zero;
        var child = new Info(); bool initialized = false;
        try
        {
            for (int index = 0; index < 3; index++)
            {
                pipes[index] = new NamedPipeClientStream(".", prefix + "-" + index, index == 0 ? PipeDirection.In : PipeDirection.Out, PipeOptions.None,
                    System.Security.Principal.TokenImpersonationLevel.Identification);
                pipes[index].Connect(2000); uint server;
                Need(GetNamedPipeServerProcessId(pipes[index].SafePipeHandle, out server) && server == ownerPid);
                Need(SetHandleInformation(pipes[index].SafePipeHandle.DangerousGetHandle(), 1, 1));
            }
            var attributes = new Attributes { Length = Marshal.SizeOf(typeof(Attributes)), Inherit = 1 };
            sentinel = CreateEvent(ref attributes, true, false, null); Need(sentinel != IntPtr.Zero);
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size); Need(size != IntPtr.Zero);
            list = Marshal.AllocHGlobal(size); Need(InitializeProcThreadAttributeList(list, 1, 0, ref size)); initialized = true;
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            for (int index = 0; index < 3; index++) Marshal.WriteIntPtr(handles, index * IntPtr.Size, pipes[index].SafePipeHandle.DangerousGetHandle());
            Need(UpdateProcThreadAttribute(list, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));
            var startup = new Extended(); startup.Startup.Size = Marshal.SizeOf(typeof(Extended)); startup.Startup.Flags = 0x100;
            startup.Startup.Input = pipes[0].SafePipeHandle.DangerousGetHandle(); startup.Startup.Output = pipes[1].SafePipeHandle.DangerousGetHandle(); startup.Startup.Error = pipes[2].SafePipeHandle.DangerousGetHandle(); startup.List = list;
            // Commands are selected by the compiled caller, never a pipe payload.
            string command = "\"" + image + "\" " + fixedCommand + (testSentinel ? " " + sentinel.ToInt64() : "");
            Need(CreateExtended(image, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, 0x08080004, IntPtr.Zero, cwd, ref startup, out child));
            Need(IsProcessInJob(child.Process, IntPtr.Zero, out member) && member && GuestJobNative.Principal(child.Process) == GuestJobNative.Principal(Process.GetCurrentProcess().Handle) &&
                String.Equals(GuestJobNative.Image(child.Process), image, StringComparison.OrdinalIgnoreCase));
            Need(ResumeThread(child.Thread) == 1);
            foreach (var pipe in pipes) pipe.Dispose(); // Child alone keeps its stdin reader/output writers.
            Need(GuestJobNative.WaitForSingleObject(child.Process, 7000) == 0);
            uint code; Need(GetExitCodeProcess(child.Process, out code) && GuestJobNative.WaitForSingleObject(sentinel, 0) == 0x102);
            return unchecked((int)code);
        }
        finally
        {
            foreach (var pipe in pipes) if (pipe != null) pipe.Dispose();
            if (child.Thread != IntPtr.Zero) GuestJobNative.CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) GuestJobNative.CloseHandle(child.Process);
            if (initialized) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list); if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            if (sentinel != IntPtr.Zero) GuestJobNative.CloseHandle(sentinel);
        }
    }
}
