using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Security.Principal;
using Aegis.ProtectedSession;

public interface ICloudGuestStdioPhase : IDisposable
{
    string EnvironmentBlock { get; }
    void Capture(IntPtr root, IntPtr job, uint pid, string image, int session);
    void Execute(Dictionary<string, object> receipt);
    void ObserveClosure(bool confirmed, Dictionary<string, object> receipt, Stopwatch ownerClock);
}
internal static class CensusFixture
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    { internal int Size; internal string Reserved,Desktop,Title; internal uint X,Y,XS,YS,XC,YC,Fill,Flags; internal ushort Show,Length; internal IntPtr ReservedData,Input,Output,Error; }
    [StructLayout(LayoutKind.Sequential)] private struct Info { internal IntPtr Process,Thread; internal uint Pid,Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct Basic
    { internal long User,Job; internal uint Flags; internal UIntPtr WorkingMin,WorkingMax; internal uint Active; internal UIntPtr Affinity; internal uint Priority,Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Io { internal ulong R,W,O,RB,WB,OB; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits { internal Basic Basic; internal Io Io; internal UIntPtr P,J,PP,PJ; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr security,string name);
    [DllImport("kernel32.dll")] private static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits limits,int size);
    [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll")] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", EntryPoint="CreateProcessW", CharSet=CharSet.Unicode)] private static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out Info process);
    private static IntPtr job;
    private static string node,mode;
    private static bool active,fired;
    private static readonly List<Info> processes = new List<Info>();
    internal static void At(string point)
    {
        string selected=mode.StartsWith("exit-",StringComparison.Ordinal)?mode.Substring(5):mode=="unknown"?"before-members":mode;
        if(!active||fired||point!=selected)return;
        fired=true;
        if(mode.StartsWith("exit-",StringComparison.Ordinal)) {
            Need(TerminateProcess(processes[1].Process,137));
            Need(GuestJobNative.WaitForSingleObject(processes[1].Process,2000)==0);
        } else Start(mode=="unknown"?Path.Combine(Path.GetDirectoryName(typeof(CensusFixture).Assembly.Location),"unknown.exe"):typeof(CensusFixture).Assembly.Location,"helper");
    }
    private static Info Start(string image,string arguments)
    {
        var startup=new Startup{Size=Marshal.SizeOf(typeof(Startup))}; Info process;
        Need(CreateProcess(image,new StringBuilder("\""+image+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,Path.GetDirectoryName(image),ref startup,out process));
        processes.Add(process);
        try { Need(AssignProcessToJobObject(job,process.Process)); Need(ResumeThread(process.Thread)==1); }
        catch { Need(TerminateProcess(process.Process,137)); Need(GuestJobNative.WaitForSingleObject(process.Process,2000)==0); throw; }
        return process;
    }
    private static void Need(bool value) { if(!value)throw new InvalidOperationException("census-fixture-refused"); }
    private static int Main(string[] args)
    {
        if(args.Length==1&&args[0]=="helper") { using(var hold=new ManualResetEvent(false))hold.WaitOne(15000); return 0; }
        try { return Run(args); }
        catch(Exception error) { Console.Error.WriteLine(error.GetType().Name+":"+error.Message); return 1; }
    }
    private static int Run(string[] args)
    {
        Need(args.Length==3); node=args[0]; mode=args[1]; string operation=args[2];
        job=CreateJobObject(IntPtr.Zero,null); Need(job!=IntPtr.Zero); var limits=new Limits(); limits.Basic.Flags=0x2000|8; limits.Basic.Active=4;
        Need(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(Limits))));
        bool refused=false,closed=false; long elapsed=0; int observed=0;
        using(var phase=new CloudGuestStdioPhase(WindowsIdentity.GetCurrent().User.Value,1))
        {
            try {
                Info root=Start(node,"-e \"setInterval(()=>{},1000)\"");
                if(operation=="capture")active=true;
                try { phase.Capture(root.Process,job,root.Pid,node,Process.GetCurrentProcess().SessionId); }
                catch(InvalidOperationException) { refused=true; }
                if(operation!="capture") {
                    if(mode=="stable"||mode.StartsWith("exit-",StringComparison.Ordinal))Start(typeof(CensusFixture).Assembly.Location,"helper");
                    active=true; var watch=Stopwatch.StartNew();
                    string method=operation=="cancel"?"RetainCancellationPayload":"Discover";
                    try { typeof(CloudGuestStdioPhase).GetMethod(method,BindingFlags.NonPublic|BindingFlags.Instance).Invoke(phase,operation=="cancel"?new object[]{0}:null); }
                    catch(TargetInvocationException error) { Need(error.InnerException is InvalidOperationException||error.InnerException is InvalidDataException); refused=true; }
                    elapsed=watch.ElapsedMilliseconds;
                }
                foreach(object member in (System.Collections.IEnumerable)typeof(CloudGuestStdioPhase).GetField("observed",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(phase))observed++;
                var clock=Stopwatch.StartNew(); Need(TerminateJobObject(job,137));
                foreach(var process in processes)Need(GuestJobNative.WaitForSingleObject(process.Process,2000)==0);
                Need(GuestJobNative.Counts(job).Active==0); closed=true;
                var receipt=new Dictionary<string,object>(); phase.ObserveClosure(closed,receipt,clock);
                Need((bool)receipt["stdioRetainedMembersExitObserved"]);
                Console.WriteLine("{\"refused\":"+refused.ToString().ToLowerInvariant()+",\"injected\":"+fired.ToString().ToLowerInvariant()+
                    ",\"observed\":"+observed+",\"elapsed\":"+elapsed+",\"closed\":true,\"retainedExited\":true,\"retries\":"+
                    receipt["stdioStartupCensusRetries"]+",\"checkpoint\":"+receipt["stdioCensusCheckpoint"]+"}");
                return 0;
            }
            finally {
                Need(TerminateJobObject(job,137));
                foreach(var process in processes) { Need(GuestJobNative.WaitForSingleObject(process.Process,2000)==0); GuestJobNative.CloseHandle(process.Thread); GuestJobNative.CloseHandle(process.Process); }
                GuestJobNative.CloseHandle(job);
            }
        }
    }
}
