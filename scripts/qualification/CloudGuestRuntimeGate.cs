using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// Lab-only retained endpoint. Its challenge is framing, never server attestation.
internal sealed class CloudGuestRuntimeGate : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct Attributes
    { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string value,
        uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateNamedPipe(string name, uint access, uint mode,
        uint instances, uint output, uint input, uint timeout, ref Attributes attributes);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ConnectNamedPipe(SafeFileHandle pipe, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteFile(SafeFileHandle pipe, byte[] bytes, uint count,
        out uint written, IntPtr overlapped);

    internal readonly string Session = Guid.NewGuid().ToString("N");
    internal readonly string Request = Guid.NewGuid().ToString("N");
    internal readonly string PipeName = "aegis-cloud-runtime-" + Guid.NewGuid().ToString("N");
    private SafeFileHandle pipe;
    private CallerRegistration registration;
    private CallerAdmission.Context admitted;
    private bool released;
    private bool startupSealed;
    internal CloudGuestRuntimeGate(string expectedSid)
    {
        // Only the new disposable endpoint receives this descriptor. No existing ACL is edited.
        string sid = new SecurityIdentifier(expectedSid).Value;
        IntPtr descriptor = IntPtr.Zero; uint size;
        try
        {
            Need(ConvertStringSecurityDescriptorToSecurityDescriptor(
                "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;" + sid + ")", 1, out descriptor, out size));
            var attributes = new Attributes { Length = Marshal.SizeOf(typeof(Attributes)), Descriptor = descriptor };
            // First instance, non-inherited, local-only, complete message input; polling never blocks.
            pipe = CreateNamedPipe(@"\\.\pipe\" + PipeName, 3 | 0x80000, 4 | 2 | 1 | 8,
                1, 4096, 4096, 0, ref attributes);
            Need(pipe != null && !pipe.IsInvalid);
        }
        catch { Dispose(); throw; }
        finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    internal void Attach(IntPtr heldProcess)
    {
        Need(registration == null && pipe != null && !pipe.IsClosed);
        registration = new CallerRegistration(heldProcess, Session);
    }
    internal void ObserveInitialized()
    {
        Need(registration != null && admitted == null && !released);
        var clock = Stopwatch.StartNew();
        while (true)
        {
            registration.CheckCurrent();
            bool connected = ConnectNamedPipe(pipe, IntPtr.Zero);
            int error = Marshal.GetLastWin32Error();
            uint peer;
            // NOWAIT's first true can merely establish listening. Require a real client.
            if ((connected || error == 535) && CallerNative.GetNamedPipeClientProcessId(pipe, out peer))
            { registration.CheckLive(peer); break; }
            Need((connected || error == 536) && clock.ElapsedMilliseconds < 3000);
            Thread.Sleep(2);
        }
        Write(Encoding.ASCII.GetBytes(registration.Generation));
        admitted = CallerAdmission.ReadAndAuthenticate(pipe, registration, new CallerNative());
        Need(admitted.RequestId == Request);
        admitted.CheckCurrent();
    }
    internal void SealInitializedRuntime(GuestJobInventory inventory)
    {
        Need(inventory != null && admitted != null && !released && !startupSealed && !CallerNative.HasThreadToken());
        registration.CheckCurrent(); admitted.CheckCurrent();
        inventory.SealInitializedRuntime();
        registration.CheckCurrent(); admitted.CheckCurrent(); startupSealed = true;
    }
    internal void CheckBeforeCancellation(GuestJobInventory inventory)
    {
        Need(inventory != null && admitted != null && !released && startupSealed);
        inventory.ValidateInitial(); registration.CheckCurrent(); admitted.CheckCurrent();
    }
    internal void ReleaseFixedTask(GuestJobInventory inventory)
    {
        Need(inventory != null && admitted != null && !released && startupSealed);
        // Fixed integration point: a separate lab network receiver may be constructed
        // immediately before this method, after initialized-runtime observation.
        // No arbitrary callback runs inside the gate.
        inventory.ValidateInitial();
        registration.CheckCurrent(); admitted.CheckCurrent();
        Write(new byte[] { 82 }); // Exactly one R. Project code has not run before this ACK.
        released = true;
    }
    private void Write(byte[] bytes)
    {
        uint written;
        Need(pipe != null && !pipe.IsClosed && WriteFile(pipe, bytes, (uint)bytes.Length,
            out written, IntPtr.Zero) && written == bytes.Length);
    }
    private static void Need(bool value)
    { if (!value) throw new InvalidOperationException("guest-runtime-gate-refused"); }
    public void Dispose()
    {
        admitted = null;
        if (registration != null) { registration.Dispose(); registration = null; }
        if (pipe != null) { pipe.Dispose(); pipe = null; }
    }
}
