using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

// Compiled together with the production NativeLaunch.cs. Every output belongs
// to the dedicated fixture directory containing this test executable.
internal static class AtomicFixture
{
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr process,uint ms);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    private static readonly string Root=AppDomain.CurrentDomain.BaseDirectory;
    private static string PathFor(string name,string suffix) {return Path.Combine(Root,name+"."+suffix);}
    private static void Need(bool result,string message) {if(!result)throw new Exception(message+" win32="+Marshal.GetLastWin32Error());}
    private static int Main(string[] args)
    {
        try {
            if(args.Length==2 && args[0]=="sentinel") {File.WriteAllText(PathFor(args[1],"sentinel"),"executed");return 0;}
            if(args.Length==2 && args[0]=="owner") {Owner(args[1]);return 0;}
            Run("null-handles");Run("handle-list");Control();return 0;
        } catch(Exception error) {File.WriteAllText(Path.Combine(Root,args.Length==2&&args[0]=="owner"?args[1]+".owner-failure":"atomic.failure"),error.ToString());Console.Error.WriteLine(error.Message);return 1;}
    }
    private static void Owner(string name)
    {
        string executable=Process.GetCurrentProcess().MainModule.FileName;
        using(var job=NativeLaunch.NewJob())
        using(var nul=new FileStream(Path.Combine(Root,"fixture-stdio.txt"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.ReadWrite)) {
            IntPtr duplicate=IntPtr.Zero;
            try {
                bool withHandles=name=="handle-list";
                if(withHandles)duplicate=NativeLaunch.InheritableDuplicate(nul.SafeFileHandle.DangerousGetHandle());
                using(var child=NativeLaunch.Start(executable,new[]{"sentinel",name},NativeLaunch.MinimalEnvironment(),job,
                    withHandles?new[]{duplicate}:null,duplicate,duplicate,duplicate,
                    delegate(IntPtr handle,uint pid) {
                        File.WriteAllText(PathFor(name,"barrier"),pid.ToString());
                        if(name!="control") new ManualResetEvent(false).WaitOne(30000);
                    })) {
                    if(name=="control")Need(child.Wait(5000) && child.ExitCode==0,"control child completion");
                }
            } finally {if(duplicate!=IntPtr.Zero)NativeLaunch.CloseHandle(duplicate);}
        }
    }
    private static Process StartOwner(string name)
    {
        string exe=Process.GetCurrentProcess().MainModule.FileName;
        var start=new ProcessStartInfo(exe,"owner "+name);start.UseShellExecute=false;start.CreateNoWindow=true;
        return Process.Start(start);
    }
    private static void WaitBarrier(Process owner,string name)
    {
        Stopwatch clock=Stopwatch.StartNew();
        while(clock.ElapsedMilliseconds<5000) {if(File.Exists(PathFor(name,"barrier")))return;if(owner.HasExited)throw new Exception("owner exited before barrier");Thread.Sleep(10);}
        throw new Exception("barrier timeout");
    }
    private static void Run(string name)
    {
        File.Delete(PathFor(name,"barrier"));File.Delete(PathFor(name,"sentinel"));
        using(Process owner=StartOwner(name)) {
            IntPtr child=IntPtr.Zero;
            try {
                WaitBarrier(owner,name);uint pid=UInt32.Parse(File.ReadAllText(PathFor(name,"barrier")));
                child=OpenProcess(0x00101000,false,pid);Need(child!=IntPtr.Zero,"capture child");
                Need(WaitForSingleObject(child,0)==258 && !owner.HasExited,"child and owner live at barrier");
                Need(!File.Exists(PathFor(name,"sentinel")),"sentinel before owner termination");
                Stopwatch deadline=Stopwatch.StartNew();Need(TerminateProcess(owner.Handle,88),"terminate owner");
                Need(WaitForSingleObject(owner.Handle,5000)==0,"owner death");
                long remaining=5000-deadline.ElapsedMilliseconds;Need(remaining>0,"child shared deadline");
                Need(WaitForSingleObject(child,(uint)remaining)==0 && deadline.ElapsedMilliseconds<5000,"child death");
                Need(!File.Exists(PathFor(name,"sentinel")),"suspended child executed");
                string result="PASS "+name+" owner="+owner.Id+" child="+pid+" child handle signaled in "+deadline.ElapsedMilliseconds+" ms; sentinel absent";
                File.WriteAllText(PathFor(name,"result"),result);Console.WriteLine(result);
            } finally {if(!owner.HasExited){owner.Kill();owner.WaitForExit(5000);}if(child!=IntPtr.Zero){if(WaitForSingleObject(child,0)==258)TerminateProcess(child,2);CloseHandle(child);}}
        }
    }
    private static void Control()
    {
        File.Delete(PathFor("control","barrier"));File.Delete(PathFor("control","sentinel"));
        using(Process owner=StartOwner("control")) {Need(owner.WaitForExit(5000) && owner.ExitCode==0,"control owner exit");Need(File.Exists(PathFor("control","sentinel")),"control sentinel missing");}
        const string result="PASS control resumed child and created sentinel";File.WriteAllText(PathFor("control","result"),result);Console.WriteLine(result);
    }
}
