using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Security.Principal;

// Owns one real, hidden Windows console. Input is scripted fixture input, not human authentication.
internal static class PackagedOwnerConsole
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct Startup { public int cb; public string a,b,c; public uint x,y,xs,ys,xc,yc,fill,flags; public short show,reserved; public IntPtr ptr,input,output,error; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Explicit, Size=20)] private struct Input { [FieldOffset(0)] public ushort type; [FieldOffset(4)] public int down; [FieldOffset(8)] public ushort repeat; [FieldOffset(10)] public ushort vk; [FieldOffset(14)] public char ch; }
    [StructLayout(LayoutKind.Sequential)] private struct Coord { public short x,y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public short left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct BufferInfo { public Coord size,cursor; public ushort attributes; public Rect window; public Coord maximum; }
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetConsoleScreenBufferInfo(IntPtr handle,out BufferInfo info);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool ReadConsoleOutputCharacter(IntPtr handle, [Out] char[] text,uint length,Coord start,out uint read);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool WriteConsoleInput(IntPtr handle,Input[] records,uint length,out uint written);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool PeekConsoleInput(IntPtr handle,[Out] Input[] records,uint length,out uint read);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool CreateProcess(string app,StringBuilder command,IntPtr a,IntPtr b,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool TerminateProcess(IntPtr handle,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle,uint ms);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GenerateConsoleCtrlEvent(uint kind,uint group);
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static void Need(bool value,string reason) { if(!value) throw new IOException(reason+" win32="+Marshal.GetLastWin32Error()); }
    private static string Quote(string value) { return "\""+Regex.Replace(value,"(\\\\*)\"","$1$1\\\"")+new string('\\',value.Length-value.TrimEnd('\\').Length)+"\""; }
    private static ProcessInfo Start(string exe,string arguments,string cwd,bool console)
    {
        Startup startup=new Startup();startup.cb=Marshal.SizeOf(typeof(Startup));startup.flags=1;startup.show=0;
        ProcessInfo result;Need(CreateProcess(exe,new StringBuilder(Quote(exe)+" "+arguments),IntPtr.Zero,IntPtr.Zero,false,console?0x10u:0u,IntPtr.Zero,cwd,ref startup,out result),"create");CloseHandle(result.thread);return result;
    }
    private static void Save(string root,string name,object value) { File.WriteAllText(Path.Combine(root,name),Json.Serialize(value)); }
    private static int Main(string[] args)
    {
        string root=args.Length==2?Path.GetFullPath(args[1]):null;
        if(root==null || !Directory.Exists(root)) return 2;
        try { if(args[0]=="inner") Inner(root); else if(args[0]=="outer") Outer(root); else return 2; return 0; }
        catch(Exception error) { Save(root,args[0]+"-failure.json",new { status="FAIL",reason=error.ToString() });return 1; }
    }
    private static void Outer(string root)
    {
        string exe=Process.GetCurrentProcess().MainModule.FileName;
        ProcessInfo child=Start(exe,"inner "+Quote(root),root,true);
        bool forced=false;
        try {
            if(WaitForSingleObject(child.process,45000)!=0) { forced=true;TerminateProcess(child.process,2);Need(WaitForSingleObject(child.process,5000)==0,"outer cleanup"); }
            uint code;Need(GetExitCodeProcess(child.process,out code),"outer exit");
            Save(root,"outer.json",new { code=code,forced=forced });Need(!forced && code==0,"inner result");
        } finally { CloseHandle(child.process); }
    }
    private static void Inner(string root)
    {
        Console.CancelKeyPress += delegate(object sender,ConsoleCancelEventArgs e) { e.Cancel=true; };
        dynamic plan=Json.DeserializeObject(File.ReadAllText(Path.Combine(root,"plan.json")));
        string launcher=(string)plan["launcher"], profile=(string)plan["profile"], policy=(string)plan["policy"], request=(string)plan["request"], endpoint=(string)plan["endpoint"];
        IntPtr input=GetStdHandle(-10), output=GetStdHandle(-12);BufferInfo info;
        Need(GetConsoleScreenBufferInfo(output,out info),"real console required");
        var listing=new List<bool>();string ancestor=profile;
        while(ancestor!=null && listing.Count<32) {
            bool readable=false;
            try { using(var entries=Directory.EnumerateFileSystemEntries(ancestor).GetEnumerator()) { entries.MoveNext();readable=true; } } catch { }
            listing.Add(readable);var parent=Directory.GetParent(ancestor);ancestor=parent==null?null:parent.FullName;
        }
        int ownedMarkers=0;
        using(var identity=WindowsIdentity.GetCurrent()) {
            foreach(string name in new[]{"appdata","localappdata","userprofile","home","temp"}) {
                try { var owner=File.GetAccessControl(Path.Combine(profile,name,".aegis-owner-profile-anchor")).GetOwner(typeof(SecurityIdentifier)); if(owner.Equals(identity.User)) ownedMarkers++; } catch { }
            }
        }
        Save(root,"profile-preflight.json",new { ancestorListingAvailable=listing.ToArray(),ownedMarkers=ownedMarkers,appDataKnown=!String.IsNullOrEmpty(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)),localAppDataKnown=!String.IsNullOrEmpty(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)) });
        ProcessInfo child=Start(launcher,"--profile-root "+Quote(profile)+" --action-mcp-delete-review "+Quote(policy)+" "+Quote(request)+" "+Quote(endpoint),root,false);
        bool forced=false, answered=false, review=false, interrupted=false;uint exit=999;string lastText=null;
        string lastInput=null;
        Save(root,"started.json",new { pid=child.pid,console=true,scriptedInput=true });
        Stopwatch clock=Stopwatch.StartNew();
        try {
            while(WaitForSingleObject(child.process,0)!=0 && clock.ElapsedMilliseconds<35000) {
                Input[] pending=new Input[16];uint pendingCount;
                Need(PeekConsoleInput(input,pending,(uint)pending.Length,out pendingCount),"input metadata observation");
                if(pendingCount>0) {
                    ushort[] types=new ushort[pendingCount];for(int i=0;i<pendingCount;i++)types[i]=pending[i].type;
                    string inputMetadata=Json.Serialize(new { elapsedMs=clock.ElapsedMilliseconds,eventTypes=types });
                    if(inputMetadata!=lastInput) { File.WriteAllText(Path.Combine(root,"input-events.json"),inputMetadata);lastInput=inputMetadata; }
                }
                Need(GetConsoleScreenBufferInfo(output,out info),"console observation");
                char[] text=new char[Math.Min(32768,info.size.x*info.size.y)];uint count;
                Need(ReadConsoleOutputCharacter(output,text,(uint)text.Length,new Coord(),out count),"console read");
                string currentText=new string(text,0,(int)count);
                if(currentText!=lastText) { File.WriteAllText(Path.Combine(root,"screen.txt"),currentText);lastText=currentText; }
                Match match=Regex.Match(currentText,"Type DELETE ([0-9a-f]{32}) and press Enter");
                if(match.Success && !review) { review=true;Save(root,"review.json",new { observed=true,scriptedInput=true }); }
                string control=Path.Combine(root,"control.txt");
                if(review && !answered && File.Exists(control)) {
                    string action=File.ReadAllText(control);
                    if(action=="interrupt") { Need(GenerateConsoleCtrlEvent(0,0),"interrupt");interrupted=true;answered=true; }
                    else if(action=="approve" || action=="reject") {
                        string value=action=="approve"?"DELETE "+match.Groups[1].Value+"\r":"NO\r";
                        Input[] records=new Input[value.Length*2];
                        for(int i=0;i<value.Length;i++) { records[2*i].type=1;records[2*i].down=1;records[2*i].repeat=1;records[2*i].ch=value[i];records[2*i].vk=(ushort)(value[i]=='\r'?13:char.ToUpperInvariant(value[i]));records[2*i+1]=records[2*i];records[2*i+1].down=0; }
                        uint written;Need(WriteConsoleInput(input,records,(uint)records.Length,out written) && written==records.Length,"console input");answered=true;
                    }
                }
                Thread.Sleep(25);
            }
            if(WaitForSingleObject(child.process,0)!=0) { forced=true;Need(TerminateProcess(child.process,2),"stop owned launcher");Need(WaitForSingleObject(child.process,5000)==0,"launcher cleanup"); }
            Need(GetExitCodeProcess(child.process,out exit),"launcher exit");
            Save(root,"console.json",new { exitCode=exit,forced=forced,reviewObserved=review,answerSubmitted=answered,interruptSubmitted=interrupted });
            Need(!forced,"bounded launcher exit");
        } finally { if(WaitForSingleObject(child.process,0)!=0) TerminateProcess(child.process,2);CloseHandle(child.process); }
    }
}
