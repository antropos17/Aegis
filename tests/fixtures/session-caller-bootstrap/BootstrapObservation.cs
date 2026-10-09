using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal sealed class BootstrapCaptured : CallerBootstrapInput, IDisposable
{
    internal Created Child;
    internal SafeFileHandle Witness, JobWitness, Reader, Writer;
    internal readonly bool Mutate;
    internal BootstrapCaptured(bool mutate) { Mutate = mutate; }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
        out SafeFileHandle target, uint access, bool inherit, uint options);
    [StructLayout(LayoutKind.Sequential)] private struct Counts
    { internal long User, Kernel, PeriodUser, PeriodKernel; internal uint Faults, Total, Active, Terminated; }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind,
        out Counts value, int size, IntPtr returned);
    internal override Created Create(string image)
    {
        Child = base.Create(image);
        try
        {
            Witness = LauncherObservation.Hold(Child.Pid);
            JobWitness = CallerNative.Duplicate(Child.Job.DangerousGetHandle());
            LauncherObservation.JobAndHandles(Child.Process, Child.Thread, Child.Job);
            if (Mutate)
            {
                var read = (SafeFileHandle)typeof(CallerBootstrapInput).GetField("read", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(this);
                var write = (SafeFileHandle)typeof(CallerBootstrapInput).GetField("write", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(this);
                CallerNative.Require(DuplicateHandle(Child.Process.DangerousGetHandle(), read.DangerousGetHandle(),
                    CallerEndpointNative.GetCurrentProcess(), out Reader, 0, false, 2));
                Writer = CallerNative.Duplicate(write.DangerousGetHandle());
            }
            return Child;
        }
        catch { try { CallerLauncherNative.Stop(Child); } finally { Child.Dispose(); } throw; }
    }
    internal void Rewrite(string mode, SafeFileHandle substitute)
    {
        uint available, left, read;
        CallerNative.Require(CallerNative.PeekNamedPipe(Reader, IntPtr.Zero, 0, IntPtr.Zero, out available, out left) && available == 144);
        byte[] original = new byte[144];
        CallerNative.Require(CallerNative.ReadFile(Reader, original, 144, out read, IntPtr.Zero) && read == 144);
        string text = Encoding.ASCII.GetString(original); byte[] bytes = original;
        if (mode == "malformed") bytes[0] = (byte)'X';
        else if (mode == "non-ascii") bytes[48] = 0xff;
        else if (mode == "invalid-handle") text = text.Substring(0, 8) + new string('0', 16) + text.Substring(24);
        else if (mode == "overflow-handle") text = text.Substring(0, 8) + new string('f', 16) + text.Substring(24);
        else if (mode == "handle-substitution")
        {
            IntPtr remote = CallerBootstrapInput.DuplicateServer(substitute, Child.Process);
            text = text.Substring(0, 8) + remote.ToInt64().ToString("x16") + text.Substring(24);
        }
        else if (mode == "pid-mismatch") text = text.Substring(0, 24) + "00000001" + text.Substring(32);
        else if (mode == "birth-mismatch") text = text.Substring(0, 32) + "0000000000000001" + text.Substring(48);
        else if (mode == "session-substitution") text = text.Substring(0, 80) + new string('d', 32) + text.Substring(112);
        else if (mode == "generation-substitution") text = text.Substring(0, 112) + new string('e', 32);
        if (mode != "malformed" && mode != "non-ascii") bytes = Encoding.ASCII.GetBytes(text);
        if (mode == "truncated") Array.Resize(ref bytes, 72);
        if (mode == "trailing") { Array.Resize(ref bytes, 145); bytes[144] = 10; }
        if (mode == "second-frame") { Array.Resize(ref bytes, 288); Buffer.BlockCopy(original, 0, bytes, 144, 144); }
        if (mode != "no-frame")
        {
            uint written;
            CallerNative.Require(CallerEndpointNative.WriteFile(Writer, bytes, (uint)bytes.Length, out written, IntPtr.Zero) && written == bytes.Length);
        }
        // Restore the production sole-reader invariant before execution.
        Reader.Dispose(); CallerNative.Require(Reader.IsClosed);
        if (mode != "no-eof" && mode != "no-frame" && mode != "no-eof-cancel") Writer.Dispose();
    }
    internal bool Stopped()
    {
        Counts counts;
        return LauncherObservation.WaitForSingleObject(Witness, 2000) == 0 &&
            QueryInformationJobObject(JobWitness, 1, out counts, Marshal.SizeOf(typeof(Counts)), IntPtr.Zero) && counts.Active == 0;
    }
    public new void Dispose()
    { base.Dispose(); }
    // These independent observation handles belong to the fixture, outside transport ownership.
    internal void CloseObservations()
    {
        foreach (var handle in new[] { Reader, Writer, JobWitness, Witness }) if (handle != null) handle.Dispose();
    }
}
