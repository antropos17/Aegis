using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class OwnerFixture
{
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] private struct Startup { public int cb; public string a,b,c; public uint x,y,xs,ys,xc,yc,fill,flags; public short show,reserved; public IntPtr ptr,input,output,error; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Explicit,Size=20)] private struct Input { [FieldOffset(0)] public ushort type; [FieldOffset(4)] public int down; [FieldOffset(8)] public ushort repeat; [FieldOffset(10)] public ushort vk; [FieldOffset(14)] public char ch; }
    [StructLayout(LayoutKind.Sequential)] private struct Coord { public short x,y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public short left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct BufferInfo { public Coord size,cursor; public ushort attributes; public Rect window; public Coord maximum; }
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetConsoleScreenBufferInfo(IntPtr handle,out BufferInfo info);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] private static extern bool WriteConsoleInput(IntPtr input,Input[] records,uint length,out uint written);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] private static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr a,IntPtr b,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo p);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool TerminateProcess(IntPtr handle,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle,uint ms);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
    private static readonly string Root=AppDomain.CurrentDomain.BaseDirectory;
    private static void Need(bool value,string reason) { if(!value)throw new Exception(reason+" win32="+Marshal.GetLastWin32Error()); }
    private static string Q(string value) { return NativeLaunch.Quote(value); }
    private static int Main(string[] args) { try { if(args[0]=="fixture")Fixture(args[1]); else Outer(args[1]); return 0; } catch(Exception e) {File.WriteAllText(Path.Combine(Root,args[1]+(args[0]=="fixture"?".inner-failure":".outer-failure")),e.ToString()); Console.Error.WriteLine(e.Message); return 1;} }
    private static ProcessInfo Start(string exe,string command,uint flags,bool hidden)
    {
        Startup s=new Startup(); s.cb=Marshal.SizeOf(typeof(Startup)); if(hidden){s.flags=1;s.show=0;} ProcessInfo p;
        Need(CreateProcess(exe,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,flags,IntPtr.Zero,Root,ref s,out p),"create process"); CloseHandle(p.thread); return p;
    }
    private static void Outer(string scenario)
    {
        foreach(string suffix in new[]{".phase",".result",".failure",".inner-failure",".outer-failure",".pid",".release"}) File.Delete(Path.Combine(Root,scenario+suffix));
        string exe=Process.GetCurrentProcess().MainModule.FileName; ProcessInfo p=Start(exe,Q(exe)+" fixture "+scenario,0x10,true);
        try { if(WaitForSingleObject(p.process,15000)!=0){TerminateProcess(p.process,2);throw new Exception("fixture timeout");} uint code; Need(GetExitCodeProcess(p.process,out code),"fixture exit"); Need(code==0,"fixture exit "+code); }
        finally {CloseHandle(p.process);}
        Need(File.Exists(Path.Combine(Root,scenario+".result")),"missing fixture result"); Console.WriteLine(File.ReadAllText(Path.Combine(Root,scenario+".result")));
    }
    private static void Fixture(string scenario)
    {
        foreach(string key in new[]{"NODE_OPTIONS","NODE_DEBUG","NODE_DEBUG_NATIVE","DOTNET_STARTUP_HOOKS","COREHOST_TRACE","NODE_V8_COVERAGE","AEGIS_TEST_CANARY"}) Environment.SetEnvironmentVariable(key,"PRIVATE_ENV_CANARY");
        string exe=Path.Combine(Root,"install","resources","sidecar","aegis-owner-console.exe");
        string command=Q(exe)+" --action-mcp-delete-review "+Q("policy path "+scenario+"\\")+" "+Q("request path")+" "+Q("endpoint path");
        if(scenario=="profile" || scenario=="profile-missing") {
            string profile=Path.Combine(Root,"profiles",scenario); Directory.CreateDirectory(profile);
            foreach(string name in new[]{"appdata","localappdata","userprofile","home","temp"}) if(scenario!="profile-missing" || name!="temp")Directory.CreateDirectory(Path.Combine(profile,name));
            command=Q(exe)+" --profile-root "+Q(profile)+" --action-mcp-delete-review "+Q("policy path "+scenario+"\\")+" "+Q("request path")+" "+Q("endpoint path");
        }
        if(scenario=="redirected-stdin" || scenario=="redirected-stderr") {
            var start=new ProcessStartInfo(exe,"--action-mcp-delete-review "+Q("policy path\\")+" "+Q("request path")+" "+Q("endpoint path"));
            start.UseShellExecute=false; start.RedirectStandardInput=scenario=="redirected-stdin"; start.RedirectStandardError=scenario=="redirected-stderr";
            using(var process=Process.Start(start)) { Need(process.WaitForExit(5000),"redirected timeout"); Need(process.ExitCode==2,"redirected handle must fail"); }
            File.WriteAllText(Path.Combine(Root,scenario+".result"),"PASS "+scenario+" refused before launch"); return;
        }
        IntPtr input=GetStdHandle(-10), error=GetStdHandle(-12); BufferInfo before; Need(GetConsoleScreenBufferInfo(error,out before),"console");
        if(scenario=="early") Inject(input,"x");
        ProcessInfo p=Start(exe,command,0,false);
        IntPtr descendant=IntPtr.Zero;
        try {
            if(scenario=="stuck-descendant") {
                string pidFile=Path.Combine(Root,scenario+".pid"); for(int i=0;i<300 && !File.Exists(pidFile);i++)Thread.Sleep(20);
                uint pid=0; Need(File.Exists(pidFile) && UInt32.TryParse(File.ReadAllText(pidFile),out pid),"descendant pid");
                descendant=OpenProcess(0x00101000,false,pid); Need(descendant!=IntPtr.Zero && WaitForSingleObject(descendant,0)==258,"live descendant");
                File.WriteAllText(Path.Combine(Root,scenario+".release"),"continue");
            }
            if(scenario=="approve" || scenario=="profile" || scenario=="after" || scenario=="output-loss") {
                bool shown=false;
                for(int i=0;i<400;i++){ BufferInfo now; Need(GetConsoleScreenBufferInfo(error,out now),"console"); if(now.cursor.x!=before.cursor.x || now.cursor.y!=before.cursor.y){shown=true;break;} if(WaitForSingleObject(p.process,0)==0)break; Thread.Sleep(20); }
                Need(shown,"prompt not shown"); Thread.Sleep(100);
                Inject(input,"DELETE 0123456789abcdef0123456789abcdef\r");
                if(scenario=="after") {WaitPhase(scenario,"APPROVED");Inject(input,"x");}
            }
            if(scenario=="idle") {WaitPhase(scenario,"READY");Inject(input,"x");}
            if(WaitForSingleObject(p.process,12000)!=0){TerminateProcess(p.process,2);throw new Exception("owner timeout");}
            uint code; Need(GetExitCodeProcess(p.process,out code),"owner exit");
            string failure=Path.Combine(Root,scenario+".failure"); Need(code==((scenario=="early" || scenario=="wrong-secret" || scenario=="profile-missing")?2:0),File.Exists(failure)?File.ReadAllText(failure):"owner exit "+code);
            if(scenario=="stuck-descendant") Need(WaitForSingleObject(descendant,0)==0,"descendant still alive at successful owner exit");
            if(scenario=="early") File.WriteAllText(Path.Combine(Root,scenario+".result"),"PASS early refused before synthetic Electron launch");
            if(scenario=="wrong-secret") { Need(!File.Exists(Path.Combine(Root,scenario+".phase")),"unauthenticated verifier reached ready"); File.WriteAllText(Path.Combine(Root,scenario+".result"),"PASS wrong secret refused before ready"); }
            if(scenario=="profile-missing") { Need(!File.Exists(Path.Combine(Root,scenario+".phase")),"invalid profile reached Electron"); File.WriteAllText(Path.Combine(Root,scenario+".result"),"PASS missing profile child refused before launch"); }
        } finally {if(descendant!=IntPtr.Zero)CloseHandle(descendant);CloseHandle(p.process);}
    }
    private static void WaitPhase(string scenario,string phase) {string path=Path.Combine(Root,scenario+".phase");for(int i=0;i<300;i++){if(File.Exists(path)&&File.ReadAllText(path)==phase)return;Thread.Sleep(20);}throw new Exception("phase timeout "+phase);}
    private static void Inject(IntPtr input,string value) { Input[] records=new Input[value.Length*2];for(int i=0;i<value.Length;i++){records[2*i].type=1;records[2*i].down=1;records[2*i].repeat=1;records[2*i].ch=value[i];records[2*i].vk=(ushort)(value[i]=='\r'?13:char.ToUpperInvariant(value[i]));records[2*i+1]=records[2*i];records[2*i+1].down=0;}uint written;Need(WriteConsoleInput(input,records,(uint)records.Length,out written)&&written==records.Length,"fixture input"); }
}
