using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Aegis.EtwLifecycle;

internal sealed record PowerStamp(uint Type, DateTimeOffset Utc, long MonotonicTicks, ulong Awake100ns);
internal sealed record PowerRecord(bool Synthetic, bool Registered, bool Armed, bool Overflow,
    string? Error, uint? UnregisterStatus, long Frequency, PowerStamp? ArmStamp, PowerStamp[] Events);

// Callback work is bounded recording/signalling only. It never stops ETW or waits for I/O.
internal sealed class PowerObserver : IDisposable
{
    private readonly object gate = new();
    private readonly List<PowerStamp> events = new(16);
    private readonly bool synthetic;
    private bool registered, armed, overflow, closed, beforeArmSuspend;
    private string? error;
    private uint? unregisterStatus;
    private PowerStamp? armStamp;
    private IntPtr registration, parameters, key;
    private static long nextKey;
    private static readonly ConcurrentDictionary<IntPtr, PowerObserver> Observers = new();
    private static readonly Callback NativeCallback = Notify;
    internal TaskCompletionSource Suspend { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate uint Callback(IntPtr context, uint type, IntPtr setting);
    [StructLayout(LayoutKind.Sequential)]
    private struct Subscription { public IntPtr Callback, Context; }
    [DllImport("powrprof.dll")]
    private static extern uint PowerRegisterSuspendResumeNotification(uint flags, IntPtr recipient, out IntPtr registration);
    [DllImport("powrprof.dll")]
    private static extern uint PowerUnregisterSuspendResumeNotification(IntPtr registration);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryUnbiasedInterruptTime(out ulong value);

    internal PowerObserver(bool synthetic)
    {
        this.synthetic = synthetic;
        if (synthetic) return;
        key = new IntPtr(Interlocked.Increment(ref nextKey));
        parameters = Marshal.AllocHGlobal(Marshal.SizeOf<Subscription>());
        Marshal.StructureToPtr(new Subscription { Callback = Marshal.GetFunctionPointerForDelegate(NativeCallback), Context = key }, parameters, false);
        Observers[key] = this;
        uint status = PowerRegisterSuspendResumeNotification(2, parameters, out registration);
        if (status != 0)
        {
            Observers.TryRemove(key, out _); Marshal.FreeHGlobal(parameters); parameters = IntPtr.Zero;
            throw new Win32Exception((int)status);
        }
        registered = true;
    }

    internal void Arm()
    {
        lock (gate)
        {
            if (closed || armed || beforeArmSuspend || error != null) throw new InvalidOperationException("power-arm-invalid");
            armStamp = Capture(0); armed = true;
        }
    }

    internal static PowerStamp Capture(uint type)
    {
        if (!QueryUnbiasedInterruptTime(out var awake)) throw new Win32Exception();
        return new(type, DateTimeOffset.UtcNow, Stopwatch.GetTimestamp(), awake);
    }

    internal void Inject(PowerStamp stamp)
    {
        if (!synthetic) throw new InvalidOperationException("native-observer-cannot-inject");
        Record(stamp);
    }

    private static uint Notify(IntPtr context, uint type, IntPtr setting)
    {
        if (!Observers.TryGetValue(context, out var observer)) return 0;
        try { observer.Record(Capture(type)); }
        catch (Exception) { lock (observer.gate) observer.error = "power-callback-failed"; }
        return 0; // Never allow managed exceptions across the native callback boundary.
    }

    private void Record(PowerStamp stamp)
    {
        lock (gate)
        {
            if (closed) return;
            if (!armed) { if (stamp.Type == 4) beforeArmSuspend = true; return; }
            if (events.Count == 16) { overflow = true; return; }
            events.Add(stamp);
            if (stamp.Type == 4) Suspend.TrySetResult();
            if (stamp.Type == 18) Resume.TrySetResult();
        }
    }

    internal PowerRecord Snapshot()
    {
        lock (gate) return new(synthetic, registered, armed, overflow, error, unregisterStatus,
            Stopwatch.Frequency, armStamp, events.ToArray());
    }

    internal static bool ValidPair(PowerRecord record, bool live)
    {
        if (record.Synthetic == live || record.Registered != live || !record.Armed || record.Overflow ||
            record.Error != null || record.UnregisterStatus != (live ? 0u : null) || record.Frequency <= 0 ||
            record.ArmStamp is not { Type: 0, MonotonicTicks: >= 0 } || record.Events.Length is < 2 or > 16) return false;
        var previous = record.ArmStamp;
        int phase = 0;
        foreach (var stamp in record.Events)
        {
            if (stamp.MonotonicTicks <= previous.MonotonicTicks || stamp.Awake100ns < previous.Awake100ns) return false;
            if (phase == 0 && stamp.Type == 4) phase = 1;
            else if (phase == 1 && stamp.Type == 18) phase = 2;
            else if (phase != 2 || stamp.Type != 7) return false;
            previous = stamp;
        }
        return phase == 2;
    }

    public void Dispose()
    {
        lock (gate) { if (closed) return; closed = true; }
        if (!registered) return;
        uint status = PowerUnregisterSuspendResumeNotification(registration);
        lock (gate) unregisterStatus = status;
        Observers.TryRemove(key, out _);
        // If unregister fails, keep the tiny native subscription memory alive until
        // process exit. The immortal delegate safely ignores its removed context.
        if (status == 0) { Marshal.FreeHGlobal(parameters); parameters = IntPtr.Zero; }
    }
}
