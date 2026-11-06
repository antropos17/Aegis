using System;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

internal static class PrivatePipe
{
    [StructLayout(LayoutKind.Sequential)] private struct Security { public int length; public IntPtr descriptor; public int inherit; }
    [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint version,out IntPtr descriptor,out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern SafePipeHandle CreateNamedPipe(string name,uint open,uint mode,uint instances,uint output,uint input,uint timeout,ref Security security);

    internal static NamedPipeServerStream Create(string name)
    {
        SecurityIdentifier sid=WindowsIdentity.GetCurrent().User;
        if(sid==null) throw new InvalidOperationException("identity unavailable");
        // Read/write data and attributes, READ_CONTROL and SYNCHRONIZE, excluding
        // FILE_CREATE_PIPE_INSTANCE. Owner DACL is protected from inheritance.
        string sddl="D:P(A;;0x0012019b;;;"+sid.Value+")";
        IntPtr descriptor; uint size;
        if(!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl,1,out descriptor,out size)) throw new InvalidOperationException("security descriptor unavailable");
        try {
            Security security=new Security(); security.length=Marshal.SizeOf(typeof(Security)); security.descriptor=descriptor;
            SafePipeHandle handle=CreateNamedPipe(@"\\.\pipe\"+name,0x40080003,0x8,1,32768,32768,0,ref security);
            if(handle.IsInvalid) { handle.Dispose(); throw new InvalidOperationException("pipe unavailable"); }
            try { return new NamedPipeServerStream(PipeDirection.InOut,true,false,handle); }
            catch { handle.Dispose(); throw; }
        } finally { LocalFree(descriptor); }
    }
}
