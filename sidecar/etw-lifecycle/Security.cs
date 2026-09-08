using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal sealed record PeerIdentity(int Pid, ulong Birth, string Image, string User, string Logon, bool Elevated);

internal static class Security
{
    internal const uint ClientRights = 0x00100083; // read/write data, read attributes, synchronize; no create-instance
    private const uint FirstInstance = 0x00080000, Overlapped = 0x40000000;
    [StructLayout(LayoutKind.Sequential)] private struct Attributes { public int Length; public IntPtr Descriptor; public int Inherit; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maxInstances, uint outSize, uint inSize, uint timeout, ref Attributes attributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(SafeProcessHandle process, out ulong birth, out ulong exit, out ulong kernel, out ulong user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(SafeProcessHandle process, uint flags, StringBuilder image, ref uint length);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(SafeProcessHandle process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int infoClass, IntPtr buffer, uint length, out uint required);
    [StructLayout(LayoutKind.Sequential)] private struct SidAttributes { public IntPtr Sid; public uint Flags; }
    [DllImport("advapi32.dll")] private static extern uint GetSecurityInfo(SafePipeHandle handle, int type, uint flags, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);

    internal static string PipeName(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new InvalidDataException();
        return @"\\.\pipe\AEGIS-EtwLifecycle-" + id;
    }

    internal static PeerIdentity Current()
    {
        using var process = Process.GetCurrentProcess();
        return Observe(process);
    }

    internal static PeerIdentity Observe(Process process)
    {
        if (process.HasExited) throw new Win32Exception();
        return Observe(process.SafeHandle, process.Id);
    }

    internal static PeerIdentity Observe(SafeProcessHandle process, int pid)
    {
        if (!GetProcessTimes(process, out var birth, out _, out _, out _)) throw new Win32Exception();
        var image = new StringBuilder(32768); uint length = (uint)image.Capacity;
        if (!QueryFullProcessImageName(process, 0, image, ref length) || !OpenProcessToken(process, 8, out var token)) throw new Win32Exception();
        using (token)
        using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
        {
            // WindowsIdentity.Groups deliberately removes logon-ID groups.
            string logon = LogonSid(token);
            return new(pid, birth, image.ToString(), identity.User?.Value ?? throw new UnauthorizedAccessException(), logon,
                Elevated(token));
        }
    }

    private static bool Elevated(SafeAccessTokenHandle token)
    {
        var buffer = Marshal.AllocHGlobal(4);
        try
        {
            if (!GetTokenInformation(token, 20, buffer, 4, out var size) || size != 4) throw new Win32Exception(); // TokenElevation
            return Marshal.ReadInt32(buffer) != 0;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static string LogonSid(SafeAccessTokenHandle token)
    {
        GetTokenInformation(token, 2, IntPtr.Zero, 0, out uint size); // TokenGroups
        if (size < IntPtr.Size || size > 65536) throw new UnauthorizedAccessException();
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (!GetTokenInformation(token, 2, buffer, size, out _)) throw new Win32Exception();
            uint count = (uint)Marshal.ReadInt32(buffer); int stride = Marshal.SizeOf<SidAttributes>();
            if (count > 4096 || IntPtr.Size + (long)count * stride > size) throw new InvalidDataException();
            string? found = null;
            for (int i = 0; i < count; i++)
            {
                var group = Marshal.PtrToStructure<SidAttributes>(buffer + IntPtr.Size + i * stride);
                if ((group.Flags & 0xc0000000) != 0xc0000000) continue;
                if (found != null) throw new UnauthorizedAccessException();
                found = new SecurityIdentifier(group.Sid).Value;
            }
            return found ?? throw new UnauthorizedAccessException();
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    internal static NamedPipeServerStream Server(string id)
    {
        string sddl = $"D:P(A;;0x{ClientRights:x};;;{Current().Logon})(A;;GA;;;SY)";
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out var descriptor, out _)) throw new Win32Exception();
        try
        {
            var attributes = new Attributes { Length = Marshal.SizeOf<Attributes>(), Descriptor = descriptor };
            var pipe = CreateNamedPipe(PipeName(id), 3 | FirstInstance | Overlapped, 8, 1, 4096, 4096, 0, ref attributes); // reject remote
            if (pipe.IsInvalid) { pipe.Dispose(); throw new Win32Exception(); }
            try { return new NamedPipeServerStream(PipeDirection.InOut, true, false, pipe); }
            catch { pipe.Dispose(); throw; }
        }
        finally { LocalFree(descriptor); }
    }

    internal static NamedPipeClientStream Client(string id)
    {
        // Identification-level SQOS forbids a peer server from impersonating an elevated client.
        var pipe = CreateFile(PipeName(id), ClientRights, 0, IntPtr.Zero, 3, Overlapped | 0x00100000 | 0x00010000, IntPtr.Zero);
        if (pipe.IsInvalid) { pipe.Dispose(); throw new Win32Exception(); }
        try { return new NamedPipeClientStream(PipeDirection.InOut, true, true, pipe); }
        catch { pipe.Dispose(); throw; }
    }

    internal static void Verify(PipeStream pipe, Process expected, ulong birth, bool serverEnd, bool elevated)
    {
        bool ok = serverEnd ? GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var pid)
            : GetNamedPipeServerProcessId(pipe.SafePipeHandle, out pid);
        if (!ok || pid != expected.Id) throw new UnauthorizedAccessException();
        var actual = Observe(expected); var self = Current();
        if (actual.Birth != birth || actual.User != self.User || actual.Logon != self.Logon || actual.Elevated != elevated ||
            !actual.Image.Equals(Program.Executable, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException();
    }

    internal static bool RestrictedAcl(NamedPipeServerStream pipe)
    {
        uint status = GetSecurityInfo(pipe.SafePipeHandle, 6, 4, out _, out _, out _, out _, out var descriptor);
        if (status != 0) throw new Win32Exception((int)status);
        try
        {
            var bytes = new byte[GetSecurityDescriptorLength(descriptor)]; Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            var security = new RawSecurityDescriptor(bytes, 0);
            var aces = security.DiscretionaryAcl?.Cast<CommonAce>().ToArray() ?? [];
            return security.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected) && aces.Length == 2 &&
                aces.Any(a => a.SecurityIdentifier.Value == Current().Logon && a.AccessMask == ClientRights && a.AceQualifier == AceQualifier.AccessAllowed) &&
                aces.Any(a => a.SecurityIdentifier.Value == "S-1-5-18" && a.AceQualifier == AceQualifier.AccessAllowed);
        }
        finally { LocalFree(descriptor); }
    }
}
