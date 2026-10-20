using System.Runtime.InteropServices;

// This Job owns no termination policy: it contains the receipt-writing helper.
// Self-association adds a Job without detaching the existing chain. The supported
// ambient contract below is limit-specific, not full opaque host-policy equivalence.
internal sealed class RetentionJob : IDisposable
{
    internal readonly record struct Profile(bool InJob, Native.Limits Limits, Native.UiLimits Ui, Native.CpuLimits Cpu);
    private const uint StructuralFlags = 0x400 | 0x800 | 0x1000 | 0x2000;
    private readonly Profile ambient;
    private readonly uint flags;
    private readonly nuint processMemory;
    internal nint Handle { get; private set; }
    private bool associated;

    internal static Profile CaptureAmbient()
    {
        Native.Check(OperatingSystem.IsWindowsVersionAtLeast(10));
        Native.Check(Native.IsProcessInJob(Native.GetCurrentProcess(), 0, out bool current));
        if (!current) return default;
        // NULL addresses only the current immediate Job; this does not identify
        // an unnamed ancestor or enumerate every ancestor policy.
        Native.Check(Native.QueryInformationJobObject(0, 9, out Native.Limits limits, Marshal.SizeOf<Native.Limits>(), 0));
        Native.Check(Native.QueryInformationJobObject(0, 4, out Native.UiLimits ui, Marshal.SizeOf<Native.UiLimits>(), 0));
        Native.Check(Native.QueryInformationJobObject(0, 15, out Native.CpuLimits cpu, Marshal.SizeOf<Native.CpuLimits>(), 0));
        return new Profile(true, limits, ui, cpu);
    }

    internal static bool Supported(Profile value)
    {
        var limits = value.Limits;
        var basic = limits.Basic;
        return (value.InJob || basic.Flags == 0) &&
            (basic.Flags & ~StructuralFlags) == 0 &&
            basic.ProcessTime == 0 && basic.JobTime == 0 && basic.Minimum == 0 && basic.Maximum == 0 &&
            basic.ActiveProcesses == 0 && basic.Affinity == 0 && basic.Priority is 0 or 32 && basic.Scheduling is 0 or 5 &&
            limits.ProcessMemory == 0 && limits.JobMemory == 0 && value.Ui.Flags == 0 &&
            value.Cpu.Flags == 0 && value.Cpu.Value == 0;
    }

    internal static object Facts(Profile value) => new
    {
        inherited = value.InJob, flags = value.Limits.Basic.Flags,
        processTimeTicks = value.Limits.Basic.ProcessTime, jobTimeTicks = value.Limits.Basic.JobTime,
        minimumWorkingSet = (ulong)value.Limits.Basic.Minimum, maximumWorkingSet = (ulong)value.Limits.Basic.Maximum,
        activeProcessLimit = value.Limits.Basic.ActiveProcesses, affinity = (ulong)value.Limits.Basic.Affinity,
        priority = value.Limits.Basic.Priority, scheduling = value.Limits.Basic.Scheduling,
        processMemoryBytes = (ulong)value.Limits.ProcessMemory, jobMemoryBytes = (ulong)value.Limits.JobMemory,
        uiRestrictions = value.Ui.Flags, cpuRateFlags = value.Cpu.Flags, cpuRateValue = value.Cpu.Value
    };

    internal RetentionJob(nuint strictProcessMemory = 0)
    {
        Native.Check(strictProcessMemory == 0 || strictProcessMemory == 128 * 1024 * 1024);
        ambient = CaptureAmbient();
#if CEDAR_JOB_FIXTURE
        Program.FixtureConstruction = new { stage = "ambient-profile", profile = Facts(ambient) };
#endif
        Native.Check(Supported(ambient));
        // Preserve the documented exception behavior explicitly. Breakaway and
        // kill-on-close are deliberately absent from this new owned Job.
        flags = ambient.Limits.Basic.Flags & 0x400;
        processMemory = strictProcessMemory;
        if (processMemory != 0) flags |= 0x100;
        Handle = Native.CreateJobObjectW(0, 0);
        Native.Check(Handle != 0);
        try
        {
            Native.Check(Native.SetHandleInformation(Handle, 1, 0));
            var limits = new Native.Limits { Basic = new Native.BasicLimits { Flags = flags }, ProcessMemory = processMemory };
            Native.Check(Native.SetInformationJobObject(Handle, 9, ref limits, Marshal.SizeOf<Native.Limits>()));
            VerifyPolicy(Handle); // Configure and read back before irreversible self-association.
            var fresh = CaptureAmbient();
            Native.Check(Supported(fresh) && fresh.InJob == ambient.InJob && fresh.Limits.Basic.Flags == ambient.Limits.Basic.Flags);
            // Active policy fields are zero except explicit structural flags;
            // inactive priority/scheduling fields may report neutral OS defaults.
            // This comparison checks that profile, not unnamed Job identity.
            Native.Check(Native.AssignProcessToJobObject(Handle, Native.GetCurrentProcess()));
            associated = true;
            Verify();
        }
        catch { Dispose(); throw; }
    }

    private void VerifyPolicy(nint job)
    {
        Native.Check(Native.QueryInformationJobObject(job, 9, out Native.Limits actual, Marshal.SizeOf<Native.Limits>(), 0));
        Native.Check(Native.QueryInformationJobObject(job, 4, out Native.UiLimits ui, Marshal.SizeOf<Native.UiLimits>(), 0));
        Native.Check(Native.QueryInformationJobObject(job, 15, out Native.CpuLimits cpu, Marshal.SizeOf<Native.CpuLimits>(), 0));
        var basic = actual.Basic;
        Native.Check(basic.Flags == flags && basic.ProcessTime == 0 && basic.JobTime == 0 &&
            basic.Minimum == 0 && basic.Maximum == 0 && basic.ActiveProcesses == 0 && basic.Affinity == 0 &&
            basic.Priority is 0 or 32 && basic.Scheduling is 0 or 5 && actual.ProcessMemory == processMemory &&
            actual.JobMemory == 0 && ui.Flags == 0 && cpu.Flags == 0 && cpu.Value == 0);
    }

    internal void Verify()
    {
        Native.Check(Handle != 0 && associated);
        Native.Check(Native.GetHandleInformation(Handle, out uint handleFlags) && (handleFlags & 1) == 0);
        Native.Check(Native.IsProcessInJob(Native.GetCurrentProcess(), Handle, out bool member) && member);
        VerifyPolicy(Handle);
        // A consistency observation of the current immediate policy, not proof
        // that a matching profile identifies any unowned ancestor. Trusted absence
        // of simultaneous external reassignment is part of this narrow contract.
        VerifyPolicy(0);
    }

    internal void VerifyChild(nint process)
    {
        Verify();
        Native.Check(Native.IsProcessInJob(process, Handle, out bool member) && member);
    }

    internal object Observation() => new
    {
        ambientBeforeAssociation = Facts(ambient), associated, helperInRetention = associated,
        configuredFlags = flags, processMemoryBytes = (ulong)processMemory,
        retentionKillOnClose = false, retentionTerminationAttempted = false
    };

    public void Dispose()
    {
        // Never terminate or wait for this Job to become empty: it contains us.
        // Closing this handle does not detach any process from its Job chain.
        nint handle = Handle;
        Handle = 0;
        Native.Close(ref handle);
    }
}
