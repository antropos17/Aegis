using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// Lab-only byte transport. The caller retains launch/Job termination authority.
internal sealed class CloudGuestStdio : IDisposable
{
    internal enum Outcome { Complete, OutputLimit, Cancelled, Deadline }
    internal enum Operation { None, Identity, Connect, PeerIdentity, InputWrite, OutputPeek, ErrorPeek, OutputRead, ErrorRead }
    internal Operation LastOperation { get; private set; }
    internal int LastNativeError { get; private set; }
    internal long ExchangeElapsedMilliseconds { get; private set; }
    internal int ConnectedMask { get; private set; }
    internal sealed class Result
    {
        internal Outcome Outcome;
        internal byte[] Output, Error;
        internal int InputBytes;
        internal bool InputEof, OutputEof, ErrorEof;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Attributes
    { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string value, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateNamedPipe(string name, uint access, uint mode, uint instances, uint output, uint input, uint timeout, ref Attributes attributes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ConnectNamedPipe(SafeFileHandle pipe, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(SafeFileHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool PeekNamedPipe(SafeFileHandle pipe, IntPtr buffer, uint length, IntPtr read, out uint available, IntPtr left);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadFile(SafeFileHandle pipe, byte[] buffer, uint length, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool WriteFile(SafeFileHandle pipe, byte[] buffer, uint length, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out long birth, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    internal readonly string Prefix = "aegis-guest-stdio-" + Guid.NewGuid().ToString("N");
    private readonly SafeFileHandle[] pipes = new SafeFileHandle[3];
    private IntPtr process, job;
    private uint pid;
    private long birth;
    private readonly string principal;
    private string image;
    private bool attached, used, closed;
    internal CloudGuestStdio(string expectedSid)
    {
        principal = new SecurityIdentifier(expectedSid).Value;
        string owner = WindowsIdentity.GetCurrent().User.Value;
        IntPtr descriptor = IntPtr.Zero; uint size;
        try
        {
            Need(ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;GA;;;SY)(A;;GA;;;" + owner + ")(A;;GRGW;;;" + principal + ")", 1, out descriptor, out size));
            var attributes = new Attributes { Length = Marshal.SizeOf(typeof(Attributes)), Descriptor = descriptor };
            for (int index = 0; index < 3; index++)
            {
                // First instance, non-inherited, byte mode, NOWAIT, reject remote clients.
                pipes[index] = CreateNamedPipe(@"\\.\pipe\" + Prefix + "-" + index, (index == 0 ? 2u : 1u) | 0x80000, 1 | 8, 1, 4096, 4096, 0, ref attributes);
                Need(pipes[index] != null && !pipes[index].IsInvalid);
            }
        }
        catch { Dispose(); throw; }
        finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    internal void Attach(IntPtr heldProcess, IntPtr heldJob, string expectedImage)
    {
        Need(!closed && !attached && !used && Path.IsPathRooted(expectedImage));
        process = GuestJobNative.Retain(heldProcess);
        try
        {
            job = GuestJobNative.Retain(heldJob); pid = GuestJobNative.GetProcessId(process);
            birth = GuestJobNative.Birth(process, job, pid); image = expectedImage;
            CheckLive(); attached = true;
        }
        catch { Dispose(); throw; }
    }
    private void CheckLive()
    {
        LastOperation = Operation.Identity; LastNativeError = 0;
        Need(GuestJobNative.Birth(process, job, pid) == birth && GuestJobNative.Principal(process) == principal &&
            String.Equals(GuestJobNative.Image(process), image, StringComparison.OrdinalIgnoreCase));
    }
    private void CheckExitedIdentity(Stopwatch clock, int milliseconds, CancellationToken cancellation)
    {
        // A retained verified handle can become signaled between the live snapshot and Birth.
        // Keep exact PID/birth/Job ownership; this is not a new PID lookup or rebaseline.
        // Live identity queries may become unavailable during exit; the verified live
        // image/principal binding remains attached to this same retained birth/handle.
        bool member; long observed, exit, kernel, user; uint code;
        while (true)
        {
            Need(!cancellation.IsCancellationRequested && clock.ElapsedMilliseconds < milliseconds);
            uint state = GuestJobNative.WaitForSingleObject(process, 0);
            Need(state == 0 || state == 0x102);
            if (state == 0) break;
            Thread.Sleep(1);
        }
        Need(GuestJobNative.WaitForSingleObject(process, 0) == 0 && GuestJobNative.GetProcessId(process) == pid &&
            GetProcessTimes(process, out observed, out exit, out kernel, out user) && observed == birth && exit != 0 &&
            IsProcessInJob(process, job, out member) && member && GetExitCodeProcess(process, out code) && code == 0);
    }
    private bool ExchangeExit(bool inputEof, Stopwatch clock, int milliseconds, CancellationToken cancellation)
    {
        Need(inputEof);
        CheckExitedIdentity(clock, milliseconds, cancellation); return false;
    }
    private bool CheckExchangeLive(bool inputEof, Stopwatch clock, int milliseconds, CancellationToken cancellation)
    {
        LastOperation = Operation.Identity; LastNativeError = 0;
        // Keep wait/status and retained identity failures outside observation recovery.
        // Birth's generic InvalidDataException cannot distinguish WAIT_FAILED from exit.
        uint firstWait = GuestJobNative.WaitForSingleObject(process, 0);
        Need(firstWait == 0 || firstWait == 0x102);
        if (firstWait == 0) return ExchangeExit(inputEof, clock, milliseconds, cancellation);
        bool member; long observed, exit, kernel, user;
        Need(GuestJobNative.GetProcessId(process) == pid &&
            IsProcessInJob(process, job, out member) && member &&
            GetProcessTimes(process, out observed, out exit, out kernel, out user) && observed == birth);
        uint finalWait = GuestJobNative.WaitForSingleObject(process, 0);
        Need(finalWait == 0 || finalWait == 0x102);
        if (finalWait == 0) return ExchangeExit(inputEof, clock, milliseconds, cancellation);
        string observedPrincipal;
        try { observedPrincipal = GuestJobNative.Principal(process); }
        catch (InvalidDataException) { return ExchangeExit(inputEof, clock, milliseconds, cancellation); }
        Need(observedPrincipal == principal);
        string observedImage;
        try { observedImage = GuestJobNative.Image(process); }
        catch (InvalidDataException) { return ExchangeExit(inputEof, clock, milliseconds, cancellation); }
        Need(String.Equals(observedImage, image, StringComparison.OrdinalIgnoreCase));
        return true;
    }
    internal Result Exchange(byte[] input, int outputLimit, int errorLimit, int milliseconds, CancellationToken cancellation)
    {
        Need(attached && !used && !closed && input != null && input.Length <= 65536 &&
            outputLimit >= 1 && outputLimit <= 65536 && errorLimit >= 1 && errorLimit <= 65536 && milliseconds >= 1 && milliseconds <= 10000);
        used = true;
        var result = new Result(); var clock = Stopwatch.StartNew(); var connected = new bool[3];
        try
        {
        using (var output = new MemoryStream()) using (var error = new MemoryStream())
        {
            while (true)
            {
                if (cancellation.IsCancellationRequested) { result.Outcome = Outcome.Cancelled; break; }
                if (clock.ElapsedMilliseconds >= milliseconds) { result.Outcome = Outcome.Deadline; break; }
                CheckLive(); bool ready = true;
                for (int index = 0; index < 3; index++)
                {
                    if (!connected[index])
                    {
                        LastOperation = Operation.Connect;
                        bool success = ConnectNamedPipe(pipes[index], IntPtr.Zero); int code = Marshal.GetLastWin32Error(); uint peer;
                        LastNativeError = success ? 0 : code;
                        if ((success || code == 535) && GetNamedPipeClientProcessId(pipes[index], out peer))
                        { LastOperation = Operation.PeerIdentity; LastNativeError = 0; Need(peer == pid); CheckLive(); connected[index] = true; ConnectedMask |= 1 << index; }
                        else Need(success || code == 536);
                    }
                    ready &= connected[index];
                }
                if (ready) break;
                Thread.Sleep(1);
            }
            if (connected[0] && connected[1] && connected[2])
            {
                while (true)
                {
                    if (cancellation.IsCancellationRequested) { result.Outcome = Outcome.Cancelled; break; }
                    if (clock.ElapsedMilliseconds >= milliseconds) { result.Outcome = Outcome.Deadline; break; }
                    uint wait = GuestJobNative.WaitForSingleObject(process, 0); Need(wait == 0 || wait == 0x102);
                    bool live = wait == 0x102;
                    if (live)
                    {
                        live = CheckExchangeLive(result.InputEof, clock, milliseconds, cancellation);
                    }
                    if (!Drain(pipes[1], output, outputLimit, ref result.OutputEof) || !Drain(pipes[2], error, errorLimit, ref result.ErrorEof))
                    { result.Outcome = Outcome.OutputLimit; break; }
                    if (!result.InputEof)
                    {
                        if (result.InputBytes == input.Length) { pipes[0].Dispose(); result.InputEof = true; }
                        else
                        {
                            Need(live); int count = Math.Min(4096, input.Length - result.InputBytes);
                            var bytes = new byte[count]; Buffer.BlockCopy(input, result.InputBytes, bytes, 0, count); uint written;
                            LastOperation = Operation.InputWrite;
                            bool success = WriteFile(pipes[0], bytes, (uint)count, out written, IntPtr.Zero);
                            LastNativeError = success ? 0 : Marshal.GetLastWin32Error();
                            Need(success && written <= count); result.InputBytes += (int)written;
                        }
                    }
                    if (!live && result.InputEof && result.OutputEof && result.ErrorEof) { result.Outcome = Outcome.Complete; break; }
                    Thread.Sleep(1);
                }
            }
            result.Output = output.ToArray(); result.Error = error.ToArray();
        }
        // Closing channels is not evidence of process or Job closure. The owner must terminate/wait/query.
        return result;
        }
        finally { ExchangeElapsedMilliseconds = clock.ElapsedMilliseconds; ClosePipes(); }
    }
    private bool Drain(SafeFileHandle pipe, MemoryStream target, int limit, ref bool eof)
    {
        if (eof) return true;
        uint available;
        LastOperation = pipe == pipes[1] ? Operation.OutputPeek : Operation.ErrorPeek;
        bool peeked = PeekNamedPipe(pipe, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero);
        LastNativeError = peeked ? 0 : Marshal.GetLastWin32Error();
        if (!peeked)
        { Need(LastNativeError == 109); eof = true; return true; }
        if (available == 0) return true;
        int count = (int)Math.Min(4096u, available); var bytes = new byte[count]; uint read;
        LastOperation = pipe == pipes[1] ? Operation.OutputRead : Operation.ErrorRead;
        bool readOk = ReadFile(pipe, bytes, (uint)count, out read, IntPtr.Zero);
        LastNativeError = readOk ? 0 : Marshal.GetLastWin32Error();
        Need(readOk && read > 0 && read <= count);
        if (target.Length + read > limit) return false;
        target.Write(bytes, 0, (int)read); return true;
    }
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("guest-stdio-refused"); }
    private void ClosePipes() { foreach (var pipe in pipes) if (pipe != null) pipe.Dispose(); }
    public void Dispose()
    {
        if (closed) return; closed = true; ClosePipes();
        if (process != IntPtr.Zero) GuestJobNative.CloseHandle(process);
        if (job != IntPtr.Zero) GuestJobNative.CloseHandle(job);
        process = job = IntPtr.Zero;
    }
}
