using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Aegis.ProtectedSession;

public interface ICloudGuestStdioPhase : IDisposable
{
    string EnvironmentBlock { get; }
    void Capture(IntPtr root, IntPtr job, uint pid, string image, int session);
    void Execute(Dictionary<string, object> receipt);
    void ObserveClosure(bool confirmed, Dictionary<string, object> receipt);
}
internal static class StdioReadinessDiagnostic
{
    internal static int PayloadCount = -1;
    internal static void Payloads(int count) { PayloadCount = count; }
    internal static void Discovered()
    { using(var found=EventWaitHandle.OpenExisting(Environment.GetEnvironmentVariable("STDIO_FIXTURE_GATE")+"-discovered"))found.Set(); }
}
internal static class StdioReadinessFixture
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    { internal int Size; internal string Reserved, Desktop, Title; internal uint X,Y,XS,YS,XC,YC,Fill,Flags; internal ushort Show,Length; internal IntPtr ReservedData,Input,Output,Error; }
    [StructLayout(LayoutKind.Sequential)] private struct Info { internal IntPtr Process, Thread; internal uint Pid,Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct Basic
    { internal long User,Job; internal uint Flags; internal UIntPtr WorkingMin,WorkingMax; internal uint Active; internal UIntPtr Affinity; internal uint Priority,Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Io { internal ulong R,W,O,RB,WB,OB; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits { internal Basic Basic; internal Io Io; internal UIntPtr P,J,PP,PJ; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll")] private static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits limits,int bytes);
    [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll")] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode)] private static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out Info process);
    private static void Need(bool value) { if(!value)throw new InvalidOperationException("readiness-fixture-refused"); }
    private static int Main(string[] args)
    {
        try { return Run(args); }
        catch(Exception error) { Console.Error.WriteLine("readiness-fixture-exception:"+error.GetType().Name+":"+error.Message); return 1; }
    }
    private static int Run(string[] args)
    {
        if(args.Length==1 && args[0]=="helper")
        {
            using(var reached=EventWaitHandle.OpenExisting(Environment.GetEnvironmentVariable("STDIO_FIXTURE_GATE")+"-reached"))
            using(var release=EventWaitHandle.OpenExisting(Environment.GetEnvironmentVariable("STDIO_FIXTURE_GATE")+"-release"))
            { reached.Set(); Need(release.WaitOne(6000)); }
            if(Environment.GetEnvironmentVariable("STDIO_FIXTURE_FAKE_READY")=="1") {
                var pipes=new System.IO.Pipes.NamedPipeClientStream[3];
                try {
                    for(int i=0;i<3;i++){pipes[i]=new System.IO.Pipes.NamedPipeClientStream(".",Environment.GetEnvironmentVariable("AEGIS_STDIO_PREFIX")+"-"+i,
                        i==0?System.IO.Pipes.PipeDirection.In:System.IO.Pipes.PipeDirection.Out);pipes[i].Connect(2000);}
                    pipes[1].WriteByte(82); pipes[1].Flush();
                    using(var hold=new ManualResetEvent(false))Need(!hold.WaitOne(6000));
                }
                finally {foreach(var pipe in pipes)if(pipe!=null)pipe.Dispose();}
                return 0;
            }
            return CloudGuestStdioLauncher.RunFixed(Environment.GetEnvironmentVariable("AEGIS_STDIO_PREFIX"),uint.Parse(Environment.GetEnvironmentVariable("AEGIS_STDIO_OWNER_PID")),
                Environment.GetEnvironmentVariable("STDIO_FIXTURE_NODE"),"\""+Environment.GetEnvironmentVariable("STDIO_FIXTURE_TASK")+"\"",Environment.GetEnvironmentVariable("STDIO_FIXTURE_ROOT"),false);
        }
        Need(args.Length==5);
        string mode=args[4];
        Environment.SetEnvironmentVariable("STDIO_FIXTURE_FAKE_READY",mode=="helper-marker"?"1":null);
        int kind=int.Parse(args[3]); string gate="Local\\aegis-stdio-readiness-"+Guid.NewGuid().ToString("N");
        Environment.SetEnvironmentVariable("STDIO_FIXTURE_GATE",gate);
        Environment.SetEnvironmentVariable("STDIO_FIXTURE_NODE",args[0]);
        Environment.SetEnvironmentVariable("STDIO_FIXTURE_TASK",args[2]);
        Environment.SetEnvironmentVariable("STDIO_FIXTURE_ROOT",Path.GetDirectoryName(args[1]));
        Environment.SetEnvironmentVariable("STDIO_FIXTURE_HELPER",typeof(StdioReadinessFixture).Assembly.Location);
        using(var reached=new EventWaitHandle(false,EventResetMode.ManualReset,gate+"-reached"))
        using(var release=new EventWaitHandle(false,EventResetMode.ManualReset,gate+"-release"))
        using(var discovered=new EventWaitHandle(false,EventResetMode.ManualReset,gate+"-discovered"))
        using(var phase=new CloudGuestStdioPhase(WindowsIdentity.GetCurrent().User.Value,kind))
        {
            foreach(string part in phase.EnvironmentBlock.Split('\0')) { if(part.Length==0)continue; int split=part.IndexOf('='); Environment.SetEnvironmentVariable(part.Substring(0,split),part.Substring(split+1)); }
            IntPtr job=CreateJobObject(IntPtr.Zero,null); Info root=new Info(); GuestJobInventory inventory=null;
            var receipt=new Dictionary<string,object>(); bool refused=false, closed=false;
            Thread controller=null; bool gateObserved=false;
            try {
                Need(job!=IntPtr.Zero); var limits=new Limits(); limits.Basic.Flags=0x2000|8; limits.Basic.Active=4;
                Need(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(Limits))));
                var startup=new Startup{Size=Marshal.SizeOf(typeof(Startup))};
                Need(CreateProcess(args[0],new StringBuilder("\""+args[0]+"\" \""+args[1]+"\""),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,Path.GetDirectoryName(args[1]),ref startup,out root));
                Need(AssignProcessToJobObject(job,root.Process)); inventory=new GuestJobInventory(job,root.Process,new string[]{args[0],typeof(StdioReadinessFixture).Assembly.Location});
                phase.Capture(root.Process,job,root.Pid,args[0],Process.GetCurrentProcess().SessionId);
                controller=new Thread(delegate(){ gateObserved=reached.WaitOne(3000)&&discovered.WaitOne(3000); if(!gateObserved)return; if(kind!=5||mode=="immediate"||mode=="helper-marker")release.Set();
                    else if(mode=="delayed") { using(var delay=new ManualResetEvent(false))Need(!delay.WaitOne(600)); release.Set(); } }); controller.Start();
                Need(ResumeThread(root.Thread)==1);
                Need(reached.WaitOne(3000));
                try { phase.Execute(receipt); } catch(InvalidOperationException){refused=true;}
                Need(TerminateJobObject(job,137)); closed=inventory.ConfirmClosure(2000); Need(closed);
                foreach(string listName in new string[]{"original","observed"})
                foreach(object retained in (System.Collections.IEnumerable)typeof(CloudGuestStdioPhase).GetField(listName,BindingFlags.NonPublic|BindingFlags.Instance).GetValue(phase)) {
                    IntPtr held=(IntPtr)retained.GetType().GetField("Handle",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(retained);
                    Need(GuestJobNative.WaitForSingleObject(held,2000)==0);
                }
                phase.ObserveClosure(closed,receipt);
                Need(controller.Join(3500) && gateObserved);
                var transport=(CloudGuestStdio)typeof(CloudGuestStdioPhase).GetField("transport",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(phase);
                Console.WriteLine("{\"refused\":"+refused.ToString().ToLowerInvariant()+",\"payloadPredicate\":"+StdioReadinessDiagnostic.PayloadCount+
                    ",\"outcome\":\""+(receipt.ContainsKey("stdioOutcome")?receipt["stdioOutcome"]:"absent")+"\",\"input\":"+(receipt.ContainsKey("stdioInputBytes")?receipt["stdioInputBytes"]:0)+
                    ",\"connectedMask\":"+transport.ConnectedMask+",\"elapsed\":"+transport.ExchangeElapsedMilliseconds+",\"gateReached\":"+reached.WaitOne(0).ToString().ToLowerInvariant()+
                    ",\"jobClosed\":"+closed.ToString().ToLowerInvariant()+",\"retainedExited\":"+receipt["stdioRetainedMembersExitObserved"].ToString().ToLowerInvariant()+
                    ",\"readyBeforeTimer\":"+receipt.ContainsKey("stdioCancellationPayloadReadyBeforeTimer").ToString().ToLowerInvariant()+
                    ",\"stdioPassed\":"+receipt["stdioPassed"].ToString().ToLowerInvariant()+",\"standardUserQualified\":false}");
                return 0;
            }
            finally {
                release.Set(); if(controller!=null)Need(controller.Join(3500));
                if(job!=IntPtr.Zero)Need(TerminateJobObject(job,137)); if(inventory!=null){Need(inventory.ConfirmClosure(2000));inventory.Dispose();}
                if(root.Thread!=IntPtr.Zero)GuestJobNative.CloseHandle(root.Thread); if(root.Process!=IntPtr.Zero)GuestJobNative.CloseHandle(root.Process); if(job!=IntPtr.Zero)GuestJobNative.CloseHandle(job);
            }
        }
    }
}
