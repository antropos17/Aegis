using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal static class Program
{
    private const string PipeVariable="AEGIS_OWNER_PIPE", SecretVariable="AEGIS_OWNER_SECRET";
    private const string ElectronName="AEGIS - AI Monitoring & Threat Detection.exe";
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetConsoleMode(IntPtr handle,out uint mode);

    private static int Main(string[] args)
    {
        try {
            if(args.Length==1 && args[0]=="--worker") {
                string value=Environment.GetEnvironmentVariable("AEGIS_OWNER_CONSOLE_IN");
                Environment.SetEnvironmentVariable("AEGIS_OWNER_CONSOLE_IN",null);
                string disclosure=Environment.GetEnvironmentVariable("AEGIS_OWNER_PROFILE_DISCLOSURE");
                Environment.SetEnvironmentVariable("AEGIS_OWNER_PROFILE_DISCLOSURE",null);
                if(disclosure!=null && (disclosure.Length>8192 || !ValidDisclosure(disclosure))) return 2;
                long handle; if(!Int64.TryParse(value,out handle) || handle<=0) return 2;
                return ConsoleWorker.Run(new IntPtr(handle),GetStdHandle(-12),Console.OpenStandardInput(),Console.OpenStandardOutput(),disclosure);
            }
            if(args.Length==1 && args[0]=="--verify") return Verify();
            if(args.Length>=2 && args[0]=="--profile-root") {
                string[] selected=new string[args.Length-2]; Array.Copy(args,2,selected,0,selected.Length);
                if(!Allowed(selected)) return 2;
                using(var profile=ProfileIsolation.Open(args[1])) return Launch(selected,profile);
            }
            if(!Allowed(args)) return 2;
            return Launch(args,null);
        } catch { return 2; }
    }

    private static bool Allowed(string[] args)
    {
        if((args.Length!=4 && args.Length!=6) || args[0]!="--action-mcp-delete-review") return false;
        if(args.Length==6 && args[4]!="--observe") return false;
        for(int i=1;i<args.Length;i++) if(i!=4 || args.Length!=6) {
            if(String.IsNullOrEmpty(args[i]) || args[i].StartsWith("--",StringComparison.Ordinal) || args[i].Length>32767) return false;
        }
        return true;
    }

    private static string NativePath() { return Process.GetCurrentProcess().MainModule.FileName; }
    private static string ElectronPath() { return Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..","..",ElectronName)); }

    private static bool ValidDisclosure(string value) { foreach(char c in value) if(c!='\r' && c!='\n' && (c<0x20 || c>0x7e)) return false; return true; }

    private static int Launch(string[] args,ProfileIsolation profile)
    {
        IntPtr input=GetStdHandle(-10), error=GetStdHandle(-12), output=GetStdHandle(-11); uint mode;
        if(!GetConsoleMode(input,out mode) || !GetConsoleMode(error,out mode)) return 2;
        string native=NativePath(), electron=ElectronPath();
        string archive=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..","app.asar"));
        string main=Path.Combine(archive,"src","main","main.js");
        using(var nativeImage=PeerIdentity.PinnedImage.Open(native))
        using(var electronImage=PeerIdentity.PinnedImage.Open(electron))
        using(var applicationArchive=PeerIdentity.PinnedImage.Open(archive))
        using(var job=NativeLaunch.NewJob()) {
            WorkerHost worker=null; NativeLaunch.Child child=null;
            PeerIdentity.ProcessIdentity electronIdentity=null, verifier=null;
            IntPtr inCopy=IntPtr.Zero,outCopy=IntPtr.Zero,errCopy=IntPtr.Zero;
            byte[] secret=null; int result=2;
            try {
                if(profile!=null)profile.Validate();
                worker=WorkerHost.Start(native,job,input,error,nativeImage,profile);
                string name="aegis-owner-"+Guid.NewGuid().ToString("N"); secret=OwnerWire.Random(32);
                using(var pipe=PrivatePipe.Create(name)) {
                    var env=NativeLaunch.MinimalEnvironment();
                    if(profile!=null) {
                        profile.Validate();
                        env["AEGIS_OWNER_PROFILE_ROOT"]=profile.Root; env["APPDATA"]=profile.AppData; env["LOCALAPPDATA"]=profile.LocalAppData;
                        env["USERPROFILE"]=profile.UserProfile; env["HOME"]=profile.Home; env["TEMP"]=profile.Temp; env["TMP"]=profile.Temp;
                    }
                    env["ELECTRON_RUN_AS_NODE"]="1";
                    env[PipeVariable]=name; env[SecretVariable]=Convert.ToBase64String(secret);
                    try {
                        inCopy=NativeLaunch.InheritableDuplicate(input); outCopy=NativeLaunch.InheritableDuplicate(output); errCopy=NativeLaunch.InheritableDuplicate(error);
                        string[] appArguments=new string[args.Length+1]; appArguments[0]=main; Array.Copy(args,0,appArguments,1,args.Length);
                        child=NativeLaunch.Start(electron,appArguments,env,job,new[]{inCopy,outCopy,errCopy},inCopy,outCopy,errCopy,
                            delegate(IntPtr handle,uint pid){ if(profile!=null)profile.Validate(); electronIdentity=PeerIdentity.ProcessIdentity.CaptureLaunched(handle,electronImage); });
                    } finally { env.Remove(PipeVariable); env.Remove(SecretVariable); }
                    IAsyncResult pending=pipe.BeginWaitForConnection(null,null);
                    using(var wait=pending.AsyncWaitHandle) {
                        Stopwatch clock=Stopwatch.StartNew();
                        while(!wait.WaitOne(100)) if(clock.ElapsedMilliseconds>20000 || child.Exited || worker.Process.Exited) throw new TimeoutException();
                        pipe.EndWaitForConnection(pending);
                    }
                    verifier=PeerIdentity.VerifyPipePeer(pipe.SafePipeHandle.DangerousGetHandle(),false,electronIdentity,nativeImage,job.DangerousGetHandle());
                    OwnerAuthentication.Server(pipe,secret); Array.Clear(secret,0,secret.Length);
                    if(!verifier.IsLive() || !electronIdentity.IsLive() || worker.Process.Exited) throw new InvalidOperationException("peer unavailable");
                        OwnerSession.Run(pipe,worker,child,verifier,profile);
                    if(!worker.Stop()) throw new InvalidOperationException("worker termination unconfirmed");
                    child.Wait(5000);
                    result=child.Exited ? (int)child.ExitCode : 2;
                }
            } finally {
                if(secret!=null)Array.Clear(secret,0,secret.Length);
                if(inCopy!=IntPtr.Zero)NativeLaunch.CloseHandle(inCopy); if(outCopy!=IntPtr.Zero)NativeLaunch.CloseHandle(outCopy); if(errCopy!=IntPtr.Zero)NativeLaunch.CloseHandle(errCopy);
                bool jobStopped=false, workerStopped=worker==null, childStopped=child==null, verifierStopped=verifier==null, jobEmpty=false;
                try { jobStopped=NativeLaunch.TerminateJob(job); } catch { }
                try { if(worker!=null)workerStopped=worker.Stop(); } catch { }
                try { if(child!=null)childStopped=child.Stop(3000); } catch { }
                try { if(verifier!=null)verifierStopped=verifier.Stop(3000); } catch { }
                try { jobEmpty=NativeLaunch.WaitJobEmpty(job,3000); } catch { }
                try { if(verifier!=null)verifier.Dispose(); } catch { verifierStopped=false; }
                try { if(electronIdentity!=null)electronIdentity.Dispose(); } catch { childStopped=false; }
                try { if(child!=null)child.Dispose(); } catch { childStopped=false; }
                try { if(worker!=null)worker.Dispose(); } catch { workerStopped=false; }
                if(!jobStopped || !workerStopped || !childStopped || !verifierStopped || !jobEmpty) throw new InvalidOperationException("cleanup unconfirmed");
            }
            return result;
        }
    }

    private static int Verify()
    {
        string name=Environment.GetEnvironmentVariable(PipeVariable), encoded=Environment.GetEnvironmentVariable(SecretVariable);
        Environment.SetEnvironmentVariable(PipeVariable,null); Environment.SetEnvironmentVariable(SecretVariable,null);
        if(String.IsNullOrEmpty(name) || !name.StartsWith("aegis-owner-",StringComparison.Ordinal) || name.Length!=44) return 2;
        for(int i=12;i<name.Length;i++) if(!((name[i]>='0' && name[i]<='9') || (name[i]>='a' && name[i]<='f'))) return 2;
        byte[] secret=Convert.FromBase64String(encoded ?? "");
        if(secret.Length!=32 || Convert.ToBase64String(secret)!=encoded) return 2;
        try {
            using(var nativeImage=PeerIdentity.PinnedImage.Open(NativePath()))
            using(var electronImage=PeerIdentity.PinnedImage.Open(ElectronPath()))
            using(var pipe=new NamedPipeClientStream(".",name,PipeDirection.InOut,PipeOptions.Asynchronous)) {
                pipe.Connect(10000);
                using(var lineage=PeerIdentity.VerifyAncestorServer(pipe.SafePipeHandle.DangerousGetHandle(),electronImage,nativeImage)) {
                    OwnerAuthentication.Client(pipe,secret); Array.Clear(secret,0,secret.Length);
                    if(!lineage.IsLive()) return 2;
                    return VerifierSession.Run(pipe,lineage);
                }
            }
        } finally { Array.Clear(secret,0,secret.Length); }
    }
}
