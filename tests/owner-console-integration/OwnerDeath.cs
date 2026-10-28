using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// A separate hidden-console fixture using the existing disposable synthetic install.
internal static class OwnerDeath
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct Startup { public int cb; public string a,b,c; public uint x,y,xs,ys,xc,yc,fill,flags; public short show,reserved; public IntPtr ptr,input,output,error; }
    [StructLayout(LayoutKind.Sequential)] private struct Child { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct Entry { public uint size,usage,pid; public UIntPtr heap; public uint module,threads,parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string exe; }
    [StructLayout(LayoutKind.Sequential)] private struct Basic { public IntPtr status,peb,affinity,priority; public UIntPtr pid,parent; }
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] private static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr a,IntPtr b,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out Child p);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint id);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] private static extern bool Process32First(IntPtr snapshot,ref Entry entry);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] private static extern bool Process32Next(IntPtr snapshot,ref Entry entry);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle,uint ms);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool TerminateProcess(IntPtr handle,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder image,ref int length);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr process,int cls,out Basic info,int length,out int returned);
    private static readonly string Root=AppDomain.CurrentDomain.BaseDirectory;
    private static void Need(bool value,string reason) { if(!value)throw new Exception(reason+" win32="+Marshal.GetLastWin32Error()); }
    private static string Q(string value) { StringBuilder result=new StringBuilder("\""); int slash=0; foreach(char c in value){if(c=='\\'){slash++;continue;} if(c=='\"'){result.Append('\\',slash*2+1).Append(c);slash=0;continue;}result.Append('\\',slash).Append(c);slash=0;}return result.Append('\\',slash*2).Append('\"').ToString(); }
    private static int Main(string[] args)
    {
        try { if(args.Length==1 && args[0]=="fixture")Fixture(); else Outer(); return 0; }
        catch(Exception error) { File.WriteAllText(Path.Combine(Root,"owner-death.failure"),error.ToString()); Console.Error.WriteLine(error.Message); return 1; }
    }
    private static Child Start(string exe,string cmd,uint flags,bool hidden)
    {
        Startup s=new Startup(); s.cb=Marshal.SizeOf(typeof(Startup)); if(hidden){s.flags=1;s.show=0;} Child p;
        Need(CreateProcess(exe,new StringBuilder(cmd),IntPtr.Zero,IntPtr.Zero,false,flags,IntPtr.Zero,Root,ref s,out p),"create process"); CloseHandle(p.thread); return p;
    }
    private static void Outer()
    {
        foreach(string suffix in new[]{"phase","result","failure"})File.Delete(Path.Combine(Root,"owner-death."+suffix));
        string exe=Process.GetCurrentProcess().MainModule.FileName; Child fixture=Start(exe,Q(exe)+" fixture",0x10,true);
        try { if(WaitForSingleObject(fixture.process,12000)!=0){TerminateProcess(fixture.process,2);throw new Exception("fixture timeout");} uint code;Need(GetExitCodeProcess(fixture.process,out code) && code==0,"fixture exit"); }
        finally { CloseHandle(fixture.process); }
        Console.WriteLine(File.ReadAllText(Path.Combine(Root,"owner-death.result")));
    }
    private static long Creation(IntPtr process) {long c,e,k,u;Need(GetProcessTimes(process,out c,out e,out k,out u),"creation time");return c;}
    private static uint ActualParent(IntPtr process) {Basic b;int n;Need(NtQueryInformationProcess(process,0,out b,Marshal.SizeOf(typeof(Basic)),out n)==0,"process parent");return checked((uint)b.parent.ToUInt64());}
    private static string Image(IntPtr process) {StringBuilder b=new StringBuilder(32768);int n=b.Capacity;Need(QueryFullProcessImageName(process,0,b,ref n),"process image");return b.ToString();}
    private sealed class Held : IDisposable { internal string Label;internal uint Id;internal IntPtr Handle;public void Dispose(){if(Handle!=IntPtr.Zero){CloseHandle(Handle);Handle=IntPtr.Zero;}} }
    private static Held Find(uint parent,string image,string label,long parentCreated)
    {
        IntPtr snapshot=CreateToolhelp32Snapshot(2,0);Need(snapshot!=new IntPtr(-1),"snapshot");
        var matches=new List<Held>();
        try {
            Entry e=new Entry();e.size=(uint)Marshal.SizeOf(typeof(Entry));
            if(Process32First(snapshot,ref e))do {
                if(e.parent!=parent)continue;
                IntPtr p=OpenProcess(0x00101000,false,e.pid);if(p==IntPtr.Zero)continue;
                try {
                    if(WaitForSingleObject(p,0)==258 && String.Equals(Image(p),image,StringComparison.OrdinalIgnoreCase) && ActualParent(p)==parent && Creation(p)>parentCreated) {
                        matches.Add(new Held{Label=label,Id=e.pid,Handle=p});p=IntPtr.Zero;
                    }
                } finally {if(p!=IntPtr.Zero)CloseHandle(p);}
            } while(Process32Next(snapshot,ref e));
            Need(matches.Count==1,"expected exactly one "+label+", got "+matches.Count);
            Held result=matches[0];matches.Clear();return result;
        } finally {foreach(Held h in matches)h.Dispose();CloseHandle(snapshot);}
    }
    private static void Fixture()
    {
        string native=Path.Combine(Root,"install","resources","sidecar","aegis-owner-console.exe");
        string electron=Path.Combine(Root,"install","AEGIS - AI Monitoring & Threat Detection.exe");
        Child owner=Start(native,Q(native)+" --action-mcp-delete-review "+Q("policy path owner-death\\")+" "+Q("request path")+" "+Q("endpoint path"),0,false);
        Held worker=null,fake=null,verifier=null;
        try {
            string phase=Path.Combine(Root,"owner-death.phase");bool ready=false;
            for(int i=0;i<200;i++){if(File.Exists(phase)&&File.ReadAllText(phase)=="READY"){ready=true;break;} if(WaitForSingleObject(owner.process,0)==0)break;Thread.Sleep(20);}
            Need(ready,"fake Electron readiness");Need(WaitForSingleObject(owner.process,0)==258,"owner still live");
            long ownerCreated=Creation(owner.process);
            worker=Find(owner.pid,native,"worker",ownerCreated);
            fake=Find(owner.pid,electron,"fake Electron",ownerCreated);
            verifier=Find(fake.Id,native,"verifier",Creation(fake.Handle));
            foreach(Held h in new[]{worker,fake,verifier})Need(WaitForSingleObject(h.Handle,0)==258,h.Label+" still live");
            Stopwatch deadline=Stopwatch.StartNew();Need(TerminateProcess(owner.process,77),"terminate owner");Need(WaitForSingleObject(owner.process,5000)==0,"owner termination");
            foreach(Held h in new[]{worker,fake,verifier}) {
                long remaining=5000-deadline.ElapsedMilliseconds;Need(remaining>0,h.Label+" shared deadline");
                Need(WaitForSingleObject(h.Handle,(uint)remaining)==0,h.Label+" termination");
            }
            Need(deadline.ElapsedMilliseconds<5000,"shared termination deadline");
            File.WriteAllText(Path.Combine(Root,"owner-death.result"),"PASS owner="+owner.pid+" worker="+worker.Id+" fakeElectron="+fake.Id+" verifier="+verifier.Id+"; captured process handles all signaled within "+deadline.ElapsedMilliseconds+" ms after owner termination");
        } finally {
            if(WaitForSingleObject(owner.process,0)==258){TerminateProcess(owner.process,2);WaitForSingleObject(owner.process,5000);}
            if(worker!=null)worker.Dispose();if(fake!=null)fake.Dispose();if(verifier!=null)verifier.Dispose();CloseHandle(owner.process);
        }
    }
}
