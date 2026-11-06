using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// Compiled against the production NativeLaunch and PeerIdentity files. The
// marker and fixture processes belong only to the executable's task-temp dir.
internal static class CleanupFixture
{
    private static readonly string Root=AppDomain.CurrentDomain.BaseDirectory;
    private static string Marker(string name) {return Path.Combine(Root,name+".marker");}
    private static void Need(bool result,string reason) {if(!result)throw new Exception(reason);}
    private static int Main(string[] args)
    {
        try {
            if(args.Length==2 && args[0]=="descendant") {Thread.Sleep(30000);return 0;}
            if(args.Length==2 && args[0]=="root") {RootProcess(args[1]);return 0;}
            InvalidInputs();Run("terminate",false);Run("stop-root",true);return 0;
        } catch(Exception error) {File.WriteAllText(Path.Combine(Root,"cleanup.failure"),error.ToString());Console.Error.WriteLine(error.Message);return 1;}
    }
    private static void RootProcess(string name)
    {
        string exe=Process.GetCurrentProcess().MainModule.FileName;
        var start=new ProcessStartInfo(exe,"descendant "+name);start.UseShellExecute=false;start.CreateNoWindow=true;
        using(Process descendant=Process.Start(start)) {File.WriteAllText(Marker(name)+".pending",descendant.Id.ToString());File.Move(Marker(name)+".pending",Marker(name));Thread.Sleep(30000);}
    }
    private static void InvalidInputs()
    {
        Need(!NativeLaunch.TerminateJob(null),"null termination accepted");
        Need(!NativeLaunch.WaitJobEmpty(null,100),"null empty accepted");
        using(var invalid=new SafeFileHandle(IntPtr.Zero,false)) {
            Need(!NativeLaunch.TerminateJob(invalid),"invalid termination accepted");
            Need(!NativeLaunch.WaitJobEmpty(invalid,100),"invalid empty accepted");
        }
        using(var signal=new EventWaitHandle(false,EventResetMode.ManualReset))
        using(var wrongObject=new SafeFileHandle(signal.SafeWaitHandle.DangerousGetHandle(),false)) {
            Need(!NativeLaunch.TerminateJob(wrongObject),"non-Job termination accepted");
            Need(!NativeLaunch.WaitJobEmpty(wrongObject,100),"non-Job query accepted");
        }
        var closed=NativeLaunch.NewJob();closed.Dispose();
        Need(!NativeLaunch.TerminateJob(closed),"closed termination accepted");
        Need(!NativeLaunch.WaitJobEmpty(closed,100),"closed empty accepted");
        const string result="PASS null, invalid, non-Job and closed handles refuse confirmation";
        File.WriteAllText(Path.Combine(Root,"invalid.result"),result);Console.WriteLine(result);
    }
    private static void Run(string name,bool stopRootFirst)
    {
        File.Delete(Marker(name));
        File.Delete(Marker(name)+".pending");
        string exe=Process.GetCurrentProcess().MainModule.FileName;
        using(var image=PeerIdentity.PinnedImage.Open(exe))
        using(var job=NativeLaunch.NewJob())
        using(var root=NativeLaunch.Start(exe,new[]{"root",name},NativeLaunch.MinimalEnvironment(),job,null,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,null))
        using(var rootIdentity=PeerIdentity.ProcessIdentity.CaptureLaunched(root.Handle,image)) {
            Stopwatch timer=Stopwatch.StartNew();
            while(!File.Exists(Marker(name)) && timer.ElapsedMilliseconds<5000 && !root.Exited)Thread.Sleep(10);
            Need(File.Exists(Marker(name)),"descendant marker absent");
            uint descendantPid=UInt32.Parse(File.ReadAllText(Marker(name)));
            using(var descendant=PeerIdentity.ProcessIdentity.Capture(descendantPid,image)) {
                Need(rootIdentity.IsLive() && descendant.IsLive(),"fixture tree not live");
                Need(!NativeLaunch.WaitJobEmpty(job,0),"active Job reported empty");
                Need(!NativeLaunch.WaitJobEmpty(job,-1),"negative timeout accepted");
                Need(!rootIdentity.Stop(-1) && rootIdentity.IsLive(),"invalid Stop accepted or killed root");
                if(stopRootFirst) {
                    Need(rootIdentity.Stop(5000) && !rootIdentity.IsLive(),"retained root stop unconfirmed");
                    Need(descendant.IsLive(),"descendant exited before Job termination");
                    Need(!NativeLaunch.WaitJobEmpty(job,50),"live descendant reported empty");
                }
                Need(NativeLaunch.TerminateJob(job),"explicit Job termination failed");
                Need(NativeLaunch.WaitJobEmpty(job,5000),"Job empty not confirmed");
                Need(rootIdentity.Stop(5000) && descendant.Stop(5000),"retained process stop not confirmed");
                Need(!rootIdentity.IsLive() && !descendant.IsLive() && root.Exited,"captured processes still live");
                string result="PASS "+name+" root="+root.Id+" descendant="+descendantPid+"; actual Job active timeout refused, termination and zero-process count confirmed";
                File.WriteAllText(Path.Combine(Root,name+".result"),result);Console.WriteLine(result);
            }
        }
    }
}
