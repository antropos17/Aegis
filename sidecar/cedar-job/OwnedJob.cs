using System.Diagnostics;
using System.Runtime.InteropServices;

// Normal-user resource containment. This is not a token, filesystem or network sandbox.
internal sealed class OwnedJob : IDisposable
{
    internal const uint RequiredFlags = 0x2000 | 0x100 | 0x200 | 0x8 | 0x2 | 0x4;
    internal const nuint MemoryBytes = 256 * 1024 * 1024;
    internal const long CpuTicks = 2 * 10000000L;
    internal const int WallMs = 10000;
    private readonly object gate = new();
    internal nint Handle { get; private set; }
    internal bool Verified { get; private set; }
    private RetentionJob? retention;
    private bool childMembershipVerified;

    internal OwnedJob()
    {
        try
        {
#if CEDAR_JOB_FIXTURE
            retention = new RetentionJob(Fixture.StrictRetention ? 128u * 1024 * 1024 : 0);
#else
            retention = new RetentionJob();
#endif
            Handle = Native.CreateJobObjectW(0, 0); // Resource Job, never containing this helper.
            Native.Check(Handle != 0 && Native.SetHandleInformation(Handle, 1, 0));
#if CEDAR_JOB_FIXTURE
            Program.FixtureConstruction = new { stage = "resource-job-created" };
#endif
            var limits = new Native.Limits
            {
                Basic = new Native.BasicLimits { Flags = RequiredFlags, ActiveProcesses = 1, ProcessTime = CpuTicks, JobTime = CpuTicks },
                ProcessMemory = MemoryBytes, JobMemory = MemoryBytes
            };
            Native.Check(Native.SetInformationJobObject(Handle, 9, ref limits, Marshal.SizeOf<Native.Limits>()));
#if CEDAR_JOB_FIXTURE
            Program.FixtureConstruction = new { stage = "limits-set" };
#endif
            VerifyLimits();
            VerifyParentHierarchy();
#if CEDAR_JOB_FIXTURE
            Program.FixtureConstruction = new { stage = "caps-verified" };
#endif
        }
        catch { Dispose(); throw; }
    }

    internal void VerifyParentHierarchy()
    {
        Native.Check(retention != null);
        retention!.Verify();
        Native.Check(Handle != 0 && Native.IsProcessInJob(Native.GetCurrentProcess(), Handle, out bool member) && !member);
    }

    internal void VerifyChildMembership(nint process)
    {
        lock (gate)
        {
            VerifyParentHierarchy();
            VerifyLimits();
            Native.Check(Native.IsProcessInJob(process, Handle, out bool member) && member);
            retention!.VerifyChild(process);
            childMembershipVerified = true;
        }
    }

    internal void VerifyLimits()
    {
        lock (gate)
        {
            Native.Limits actual = default;
            Native.Check(Handle != 0 && Native.QueryInformationJobObject(Handle, 9, out actual, Marshal.SizeOf<Native.Limits>(), 0));
            // Exact flags also exclude breakaway, silent breakaway and preserved job time.
            Native.Check(actual.Basic.Flags == RequiredFlags && actual.Basic.ActiveProcesses == 1 &&
                actual.Basic.ProcessTime == CpuTicks && actual.Basic.JobTime == CpuTicks &&
                actual.ProcessMemory == MemoryBytes && actual.JobMemory == MemoryBytes);
            Native.Check(Native.GetHandleInformation(Handle, out uint handleFlags) && (handleFlags & 1) == 0);
            Verified = true;
        }
    }

    internal bool Empty()
    {
        lock (gate)
        {
            return Handle != 0 && Native.QueryInformationJobObject(Handle, 1, out Native.Accounting value, Marshal.SizeOf<Native.Accounting>(), 0) && value.ActiveProcesses == 0;
        }
    }

#if CEDAR_JOB_FIXTURE
    internal object Observation(nint originalProcess = 0)
    {
        Native.Check(Native.QueryInformationJobObject(Handle, 9, out Native.Limits limits, Marshal.SizeOf<Native.Limits>(), 0));
        Native.Check(Native.QueryInformationJobObject(Handle, 1, out Native.Accounting accounting, Marshal.SizeOf<Native.Accounting>(), 0));
        uint? exitCode = null;
        if (originalProcess != 0)
        {
            Native.Check(Native.GetExitCodeProcess(originalProcess, out uint actualExit));
            exitCode = actualExit;
        }
        return new { peakProcessBytes = (ulong)limits.PeakProcessMemory, peakJobBytes = (ulong)limits.PeakJobMemory,
            userTicks = accounting.User, totalProcesses = accounting.TotalProcesses, activeProcesses = accounting.ActiveProcesses,
            originalChildSignaled = originalProcess != 0 && Native.WaitForSingleObject(originalProcess, 0) == 0, childExitCode = exitCode,
            helperInResource = false, childInBothOwnedJobsBeforeResume = childMembershipVerified, retention = retention?.Observation() };
    }
    internal void CorruptForFixture()
    {
        Native.Check(Native.QueryInformationJobObject(Handle, 9, out Native.Limits limits, Marshal.SizeOf<Native.Limits>(), 0));
        limits.Basic.Flags &= ~0x200u;
        Native.Check(Native.SetInformationJobObject(Handle, 9, ref limits, Marshal.SizeOf<Native.Limits>()));
    }
#endif

    internal void Stop()
    {
        lock (gate) { if (Handle != 0) Native.TerminateJobObject(Handle, 1); }
    }

    internal void Revoke(int reason)
    {
        lock (gate) { Program.MarkStopped(reason); Stop(); }
    }

    internal void ResumeVerified(nint thread, nint process)
    {
        // The watchdog's revoke/terminate and the final resume share this gate.
        // A one-shot watchdog can never revoke an empty Job and then permit resume.
        lock (gate)
        {
            Program.CheckRunning();
            VerifyChildMembership(process);
            Program.CheckRunning();
            Native.Check(Native.ResumeThread(thread) == 1);
        }
    }

    internal bool StopAndConfirm(nint originalProcess)
    {
        Stop();
        var timer = Stopwatch.StartNew();
        do
        {
            if (Empty() && (originalProcess == 0 || Native.WaitForSingleObject(originalProcess, 0) == 0))
            {
#if CEDAR_JOB_FIXTURE
                if (Program.FixtureFault == "unknown-wait") return false;
#endif
                return true;
            }
            Thread.Sleep(5);
        } while (timer.ElapsedMilliseconds < 750);
        return false;
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (Handle != 0)
            {
                Native.TerminateJobObject(Handle, 1);
                Native.CloseHandle(Handle);
                Handle = 0;
            }
            retention?.Dispose();
            retention = null;
        }
    }
}
