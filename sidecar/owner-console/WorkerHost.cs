using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using Microsoft.Win32.SafeHandles;

internal sealed class WorkerHost : IDisposable
{
    internal readonly AnonymousPipeServerStream Input;
    internal readonly AnonymousPipeServerStream Output;
    internal readonly NativeLaunch.Child Process;
    private readonly PeerIdentity.ProcessIdentity identity;

    private WorkerHost(AnonymousPipeServerStream input,AnonymousPipeServerStream output,NativeLaunch.Child process,PeerIdentity.ProcessIdentity identity)
    { Input=input; Output=output; Process=process; this.identity=identity; }

    internal static WorkerHost Start(string executable,SafeFileHandle job,IntPtr consoleIn,IntPtr consoleErr,PeerIdentity.PinnedImage image)
    {
        var input=new AnonymousPipeServerStream(PipeDirection.Out,HandleInheritability.Inheritable);
        var output=new AnonymousPipeServerStream(PipeDirection.In,HandleInheritability.Inheritable);
        IntPtr consoleInput=IntPtr.Zero,consoleError=IntPtr.Zero;
        PeerIdentity.ProcessIdentity held=null; NativeLaunch.Child child=null;
        try {
            consoleInput=NativeLaunch.InheritableDuplicate(consoleIn); consoleError=NativeLaunch.InheritableDuplicate(consoleErr);
            IntPtr childInput=new IntPtr(Int64.Parse(input.GetClientHandleAsString()));
            IntPtr childOutput=new IntPtr(Int64.Parse(output.GetClientHandleAsString()));
            var env=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            foreach(string name in new[]{"SystemRoot","WINDIR","TEMP","TMP"}) { string value=Environment.GetEnvironmentVariable(name); if(!String.IsNullOrEmpty(value)) env[name]=value; }
            env["AEGIS_OWNER_CONSOLE_IN"]=consoleInput.ToInt64().ToString();
            child=NativeLaunch.Start(executable,new[]{"--worker"},env,job,new[]{childInput,childOutput,consoleInput,consoleError},childInput,childOutput,consoleError,
                delegate(IntPtr handle,uint pid) { held=PeerIdentity.ProcessIdentity.CaptureLaunched(handle,image); });
            input.DisposeLocalCopyOfClientHandle(); output.DisposeLocalCopyOfClientHandle();
            if(OwnerWire.Read(output,5000)!="H 1") throw new InvalidOperationException("console unavailable");
            return new WorkerHost(input,output,child,held);
        } catch {
            bool stopped=child==null || child.Stop(3000); if(child!=null)child.Dispose(); if(held!=null)held.Dispose(); input.Dispose(); output.Dispose();
            if(!stopped)throw new InvalidOperationException("worker termination unconfirmed"); throw;
        } finally { if(consoleInput!=IntPtr.Zero)NativeLaunch.CloseHandle(consoleInput); if(consoleError!=IntPtr.Zero)NativeLaunch.CloseHandle(consoleError); }
    }
    internal bool Stop() { bool stopped=Process.Stop(3000); try { Input.Dispose(); Output.Dispose(); } catch {} return stopped; }
    public void Dispose() { bool stopped=Stop(); identity.Dispose(); Process.Dispose(); if(!stopped)throw new InvalidOperationException("worker termination unconfirmed"); }
}
