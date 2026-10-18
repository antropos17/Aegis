using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal sealed record FileMainWitness(int pid, string birth, string handle);
internal sealed record FileMainReservation(string guid, int ownerPid, string ownerBirth, FileMainWitness[] peers);

// These are limited process-object references, never ETW control handles.
internal static class FileMainHandles
{
    internal const uint ObserveRights = 0x101000;
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern SafeProcessHandle OpenProcess(uint rights, bool inherit, int pid);
    [DllImport("kernel32.dll", EntryPoint = "DuplicateHandle", SetLastError = true)]
    private static extern bool Export(IntPtr sourceProcess, SafeProcessHandle source, SafeProcessHandle targetProcess,
        out IntPtr target, uint rights, bool inherit, uint options);
    [DllImport("kernel32.dll", EntryPoint = "DuplicateHandle", SetLastError = true)]
    private static extern bool Import(SafeProcessHandle sourceProcess, IntPtr source, IntPtr targetProcess,
        out SafeProcessHandle target, uint rights, bool inherit, uint options);
    [DllImport("kernel32.dll", EntryPoint = "DuplicateHandle", SetLastError = true)]
    private static extern bool CloseRemote(SafeProcessHandle sourceProcess, IntPtr source, IntPtr targetProcess,
        out IntPtr target, uint rights, bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(SafeProcessHandle process, out ulong birth, out ulong exit, out ulong kernel, out ulong user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeProcessHandle process, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(SafeProcessHandle process, out uint code);

    internal static long Positive(string value)
    {
        if (!long.TryParse(value, out long number) || number <= 0 || number.ToString() != value)
            throw new InvalidDataException();
        return number;
    }
    internal static ulong Birth(SafeProcessHandle process)
    {
        if (!GetProcessTimes(process, out ulong birth, out _, out _, out _) || birth == 0) throw new Win32Exception();
        return birth;
    }
    internal static bool Gone(SafeProcessHandle process) => WaitForSingleObject(process, 0) switch
    { 0 => true, 258 => false, _ => throw new Win32Exception() };
    internal static int ExitCode(SafeProcessHandle process) => Gone(process) && GetExitCodeProcess(process, out uint code)
        ? unchecked((int)code) : throw new IOException();

    internal static FileMainWitness Deposit(SafeProcessHandle owner, SafeProcessHandle original, int pid)
    {
        ulong birth = Birth(original);
        if (GetProcessId(original) != pid || Gone(original)) throw new UnauthorizedAccessException();
        if (!Export(new IntPtr(-1), original, owner, out IntPtr value, ObserveRights, false, 0)) throw new Win32Exception();
        return new(pid, birth.ToString(), value.ToInt64().ToString());
    }
    internal static SafeProcessHandle Retrieve(SafeProcessHandle owner, FileMainWitness witness)
    {
        long handle = Positive(witness.handle); ulong birth = (ulong)Positive(witness.birth);
        if (witness.pid <= 0) throw new InvalidDataException();
        if (!Import(owner, new IntPtr(handle), new IntPtr(-1), out var copy, ObserveRights, false, 0))
        { copy.Dispose(); throw new Win32Exception(); }
        try
        {
            if (GetProcessId(copy) != witness.pid || Birth(copy) != birth) throw new UnauthorizedAccessException();
            return copy;
        }
        catch { copy.Dispose(); throw; }
    }
    // Only internally created deposits or fully validated copies may reach this.
    // CLOSE_SOURCE closes regardless of API error; never retry an untrusted value.
    internal static void Release(SafeProcessHandle owner, FileMainWitness witness)
    {
        if (!CloseRemote(owner, new IntPtr(Positive(witness.handle)), IntPtr.Zero, out _, 0, false, 1))
            throw new Win32Exception();
    }
}
