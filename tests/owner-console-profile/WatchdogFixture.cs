using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

// Tests a deliberately stalled validation in a disposable owner process.
// Its child is confined to that owner's kill-on-close Job.
internal static class WatchdogFixture
{
    [StructLayout(LayoutKind.Sequential)] private struct Basic { public IntPtr status,peb,affinity,priority;public UIntPtr pid,parent; }
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool TerminateProcess(IntPtr handle,uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr process,int cls,out Basic info,int size,out int returned);
    private static readonly string Base=AppDomain.CurrentDomain.BaseDirectory;
    private static void Need(bool value,string reason){if(!value)throw new Exception(reason);}
    private static int Main(string[] args)
    {
        try {
            if(args.Length==2 && args[0]=="descendant") {File.WriteAllText(args[1]+".pending",Process.GetCurrentProcess().Id.ToString());File.Move(args[1]+".pending",args[1]);Thread.Sleep(30000);return 0;}
            if(args.Length==5 && args[0]=="owner") {Owner(args[1],args[2],args[3],args[4]);return 3;}
            DeadlineCases();Driver();return 0;
        } catch(Exception error){File.WriteAllText(Path.Combine(Base,args.Length>0?"watchdog-owner.failure":"watchdog.failure"),error.ToString());Console.Error.WriteLine(error.Message);return 1;}
    }
    private static void DeadlineCases()
    {
        // The test clock and a gated watchdog make scheduling deterministic. A
        // failed termination is simulated so a late validation must throw.
        DeadlineCompletion(Stopwatch.Frequency*3-1,false);
        DeadlineCompletion(Stopwatch.Frequency*3,true);
        DeadlineCompletion(-1,true);
        DeadlineAfterCompletionSample();
        var entered=new ManualResetEvent(false);var gate=new ManualResetEvent(false);var terminated=new ManualResetEvent(false);
        long clock=Stopwatch.Frequency*100;int terminations=0;
        try {
            ProfileIsolation.DeadlineClockForTest=delegate{return Interlocked.Read(ref clock);};
            ProfileIsolation.BeforeDeadlineWatchdogForTest=delegate{entered.Set();gate.WaitOne();};
            ProfileIsolation.DeadlineTerminateForTest=delegate{Interlocked.Increment(ref terminations);terminated.Set();return false;};
            IDisposable deadline=ProfileIsolation.NewDeadlineForTest();
            Need(entered.WaitOne(2000),"watchdog was not gated");
            Interlocked.Exchange(ref clock,Stopwatch.Frequency*103);gate.Set();
            Need(terminated.WaitOne(2000),"watchdog did not mark timeout");
            bool refused=false;try { deadline.Dispose(); } catch(InvalidOperationException) { refused=true; }
            Need(refused && terminations>=1,"marked timeout escaped after failed termination");
        } finally {
            gate.Set();ProfileIsolation.DeadlineClockForTest=null;ProfileIsolation.BeforeDeadlineWatchdogForTest=null;ProfileIsolation.DeadlineTerminateForTest=null;
            entered.Dispose();gate.Dispose();terminated.Dispose();
        }
        Console.WriteLine("PASS monotonic deadline, delayed watchdog and failed termination");
    }
    private static void DeadlineAfterCompletionSample()
    {
        var entered=new ManualResetEvent(false);var gate=new ManualResetEvent(false);
        int owner=Thread.CurrentThread.ManagedThreadId,ownerReads=0,terminations=0;
        long clock=Stopwatch.Frequency*100;
        try {
            ProfileIsolation.DeadlineClockForTest=delegate {
                if(Thread.CurrentThread.ManagedThreadId==owner) {
                    int read=Interlocked.Increment(ref ownerReads);
                    if(read==2) gate.Set();
                    if(read==3) Interlocked.Exchange(ref clock,Stopwatch.Frequency*103);
                }
                return Interlocked.Read(ref clock);
            };
            ProfileIsolation.BeforeDeadlineWatchdogForTest=delegate{entered.Set();gate.WaitOne();};
            ProfileIsolation.DeadlineTerminateForTest=delegate{Interlocked.Increment(ref terminations);return false;};
            IDisposable deadline=ProfileIsolation.NewDeadlineForTest();
            Need(entered.WaitOne(2000),"watchdog was not gated");
            Interlocked.Exchange(ref clock,Stopwatch.Frequency*103-1);
            bool refused=false;try { deadline.Dispose(); } catch(InvalidOperationException) { refused=true; }
            Need(refused && terminations>0,"deadline passed after initial completion sample");
        } finally {
            gate.Set();ProfileIsolation.DeadlineClockForTest=null;ProfileIsolation.BeforeDeadlineWatchdogForTest=null;ProfileIsolation.DeadlineTerminateForTest=null;
            entered.Dispose();gate.Dispose();
        }
    }
    private static void DeadlineCompletion(long offset,bool expectedRefusal)
    {
        var entered=new ManualResetEvent(false);var gate=new ManualResetEvent(false);
        int owner=Thread.CurrentThread.ManagedThreadId,ownerReads=0,terminations=0;
        long clock=Stopwatch.Frequency*100;
        try {
            ProfileIsolation.DeadlineClockForTest=delegate {
                if(Thread.CurrentThread.ManagedThreadId==owner && Interlocked.Increment(ref ownerReads)==2) gate.Set();
                return Interlocked.Read(ref clock);
            };
            ProfileIsolation.BeforeDeadlineWatchdogForTest=delegate{entered.Set();gate.WaitOne();};
            ProfileIsolation.DeadlineTerminateForTest=delegate{Interlocked.Increment(ref terminations);return false;};
            IDisposable deadline=ProfileIsolation.NewDeadlineForTest();
            Need(entered.WaitOne(2000),"watchdog was not gated");
            Interlocked.Exchange(ref clock,Stopwatch.Frequency*100+offset);
            bool refused=false;try { deadline.Dispose(); } catch(InvalidOperationException) { refused=true; }
            Need(refused==expectedRefusal,"deadline boundary mismatch");
            Need(!expectedRefusal || terminations>0,"late completion did not request termination");
        } finally {
            gate.Set();ProfileIsolation.DeadlineClockForTest=null;ProfileIsolation.BeforeDeadlineWatchdogForTest=null;ProfileIsolation.DeadlineTerminateForTest=null;
            entered.Dispose();gate.Dispose();
        }
    }
    private static void DeadlineOpenCustody(string root,string protect)
    {
        var entered=new ManualResetEvent(false);var gate=new ManualResetEvent(false);
        int owner=Thread.CurrentThread.ManagedThreadId,ownerReads=0;
        long clock=Stopwatch.Frequency*100;
        try {
            ProfileIsolation.ProtectedPathsForTest=delegate{return new[]{protect};};
            ProfileIsolation.DeadlineClockForTest=delegate {
                if(Thread.CurrentThread.ManagedThreadId==owner && Interlocked.Increment(ref ownerReads)==2) {
                    Interlocked.Exchange(ref clock,Stopwatch.Frequency*103);gate.Set();
                }
                return Interlocked.Read(ref clock);
            };
            ProfileIsolation.BeforeDeadlineWatchdogForTest=delegate{entered.Set();gate.WaitOne();};
            ProfileIsolation.DeadlineTerminateForTest=delegate{return false;};
            bool refused=false;try { using(ProfileIsolation.Open(root)) {} } catch(InvalidOperationException) { refused=true; }
            Need(refused,"late profile open returned its handles");
            string moved=root+"-moved";Directory.Move(root,moved);Directory.Move(moved,root);
        } finally {
            gate.Set();ProfileIsolation.ProtectedPathsForTest=null;ProfileIsolation.DeadlineClockForTest=null;
            ProfileIsolation.BeforeDeadlineWatchdogForTest=null;ProfileIsolation.DeadlineTerminateForTest=null;
            entered.Dispose();gate.Dispose();
        }
    }
    private static void Owner(string root,string protectedPath,string pidMarker,string hookMarker)
    {
        ProfileIsolation.ProtectedPathsForTest=delegate{return new[]{protectedPath};};
        ProfileIsolation.BeforeValidationForTest=delegate{};
        using(var profile=ProfileIsolation.Open(root))
        using(var job=NativeLaunch.NewJob())
        using(var child=NativeLaunch.Start(Process.GetCurrentProcess().MainModule.FileName,new[]{"descendant",pidMarker},NativeLaunch.MinimalEnvironment(),job,null,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,null)) {
            var timer=Stopwatch.StartNew();while(!File.Exists(pidMarker)&&timer.ElapsedMilliseconds<5000)Thread.Sleep(10);Need(File.Exists(pidMarker),"descendant marker");
            ProfileIsolation.BeforeValidationForTest=delegate{File.WriteAllText(hookMarker,"entered");Thread.Sleep(Timeout.Infinite);};
            profile.Validate();throw new Exception("stalled validation returned");
        }
    }
    private static void Driver()
    {
        string taskRoot=Directory.GetParent(Base.TrimEnd(Path.DirectorySeparatorChar)).FullName;
        string scratch=Path.Combine(taskRoot,"owner-console-profile-data","watchdog-"+Guid.NewGuid().ToString("N"));
        string root=Path.Combine(scratch,"selected"),protect=Path.Combine(scratch,"protected");
        Directory.CreateDirectory(protect);foreach(string name in new[]{"appdata","localappdata","userprofile","home","temp"}){string child=Path.Combine(root,name);Directory.CreateDirectory(child);File.WriteAllText(Path.Combine(child,".aegis-owner-profile-anchor"),"owned fixture anchor "+name);}
        DeadlineOpenCustody(root,protect);
        string marker=Path.Combine(Base,"watchdog-descendant.pid"),hook=Path.Combine(Base,"watchdog-hook.ready");
        File.Delete(marker);File.Delete(marker+".pending");File.Delete(hook);
        string executable=Process.GetCurrentProcess().MainModule.FileName;
        var start=new ProcessStartInfo(executable,"owner "+NativeLaunch.Quote(root)+" "+NativeLaunch.Quote(protect)+" "+NativeLaunch.Quote(marker)+" "+NativeLaunch.Quote(hook));
        start.UseShellExecute=false;start.CreateNoWindow=true;
        using(Process owner=Process.Start(start)) {
            IntPtr descendant=IntPtr.Zero;
            try {
                Stopwatch startup=Stopwatch.StartNew();
                while((!File.Exists(marker)||!File.Exists(hook)) && startup.ElapsedMilliseconds<5000 && !owner.HasExited)Thread.Sleep(10);
                Need(File.Exists(marker)&&File.Exists(hook) && !owner.HasExited,"watchdog hook readiness");
                uint pid=UInt32.Parse(File.ReadAllText(marker));descendant=OpenProcess(0x00101001,false,pid);
                Need(descendant!=IntPtr.Zero && WaitForSingleObject(descendant,0)==258,"hold live descendant");
                Basic info;int returned;Need(NtQueryInformationProcess(descendant,0,out info,Marshal.SizeOf(typeof(Basic)),out returned)==0 && info.parent.ToUInt64()==(uint)owner.Id,"descendant relationship");
                Stopwatch deadline=Stopwatch.StartNew();Need(owner.WaitForExit(5000) && owner.ExitCode==2,"watchdog owner did not exit with code 2");
                long remaining=5000-deadline.ElapsedMilliseconds;Need(remaining>0 && WaitForSingleObject(descendant,(uint)remaining)==0,"Job descendant did not exit");
                string result="PASS validation watchdog terminated owner="+owner.Id+" and Job descendant="+pid+" in "+deadline.ElapsedMilliseconds+" ms; cleanup receipt unconfirmed";
                File.WriteAllText(Path.Combine(Base,"watchdog.result"),result);Console.WriteLine(result);
            } finally {
                if(!owner.HasExited){owner.Kill();owner.WaitForExit(5000);}
                if(descendant!=IntPtr.Zero){if(WaitForSingleObject(descendant,0)==258)TerminateProcess(descendant,2);CloseHandle(descendant);}
            }
        }
    }
}
