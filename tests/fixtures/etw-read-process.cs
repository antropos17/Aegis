using System;
using System.Diagnostics;
using System.IO;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// A normal-token, independently witnessed read initiator. Never invokes a provider,
// reads a user path or logs the synthetic file contents. The caller owns this process.
internal static class EtwReadProcess
{
    internal struct WindowOwner
    {
        internal readonly uint Thread, Pid;
        internal WindowOwner(uint thread, uint pid) { Thread=thread; Pid=pid; }
    }
    internal sealed class DpiMetadata
    {
        internal readonly bool WindowExists, OwnerMatched;
        internal readonly uint Dpi;
        internal DpiMetadata(bool exists, bool matched, uint dpi) { WindowExists=exists; OwnerMatched=matched; Dpi=dpi; }
        internal string ToJson()
        {
            return "{\"command\":\"window-dpi\",\"schema\":\"aegis-window-dpi/1\",\"windowExists\":"+
                (WindowExists?"true":"false")+",\"ownerMatched\":"+(OwnerMatched?"true":"false")+
                ",\"dpi\":"+Dpi.ToString(CultureInfo.InvariantCulture)+"}";
        }
    }
    internal static void PreloadWindowDpi(Func<string,uint,IntPtr> load)
    {
        if(load("user32.dll",0x800)==IntPtr.Zero)throw new IOException();
    }
    internal static bool TryWindowDpi(string command, Func<long,bool> exists,
        Func<long,WindowOwner> owner, Func<long,uint> read, out DpiMetadata metadata)
    {
        metadata=null;
        if(string.IsNullOrEmpty(command))return false;
        var parts=command.Split(' ');
        long pid,window;
        if(parts.Length!=3 || parts[0]!="window-dpi" ||
            !PositiveNumber(parts[1],int.MaxValue,out pid) ||
            !PositiveNumber(parts[2],long.MaxValue,out window))return false;
        if(!exists(window)) { metadata=new DpiMetadata(false,false,0);return true; }
        var before=owner(window);
        if(before.Thread==0 || before.Pid!=(uint)pid) { metadata=new DpiMetadata(true,false,0);return true; }
        uint dpi=read(window);
        if(!exists(window)) { metadata=new DpiMetadata(false,false,0);return true; }
        var after=owner(window);
        metadata=after.Thread==0 || after.Pid!=(uint)pid ?
            new DpiMetadata(true,false,0) : new DpiMetadata(true,true,dpi);
        return true;
    }
    private static bool PositiveNumber(string text,long maximum,out long value)
    {
        value=0;
        if(string.IsNullOrEmpty(text) || text[0]=='0')return false;
        foreach(char digit in text)if(digit<'0' || digit>'9')return false;
        return long.TryParse(text,NumberStyles.None,CultureInfo.InvariantCulture,out value) && value>0 && value<=maximum;
    }
    [DllImport("kernel32.dll",EntryPoint="LoadLibraryExW",CharSet=CharSet.Unicode,SetLastError=true)]
    private static extern IntPtr LoadLibraryEx(string name,IntPtr file,uint flags);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    private static bool WindowExists(long window) { return IsWindow(new IntPtr(window)); }
    private static WindowOwner WindowIdentity(long window)
    {
        uint pid=0;
        uint thread=GetWindowThreadProcessId(new IntPtr(window),out pid);
        return new WindowOwner(thread,pid);
    }
    private static uint WindowDpi(long window) { return GetDpiForWindow(new IntPtr(window)); }
    private static uint fileShare=7;
    [StructLayout(LayoutKind.Sequential)]
    private struct Overlapped { public IntPtr Internal, InternalHigh; public uint Offset, OffsetHigh; public IntPtr Event; }
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(IntPtr process, out ulong birth, out ulong exit, out ulong kernel, out ulong user);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool ReadFile(SafeFileHandle file, byte[] buffer, uint size, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool ReadFile(SafeFileHandle file, byte[] buffer, uint size, out uint read, ref Overlapped overlapped);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool ReadFile(SafeFileHandle file, IntPtr buffer, uint size, out uint read, ref Overlapped overlapped);
    [DllImport("kernel32.dll")] private static extern IntPtr VirtualAlloc(IntPtr address, UIntPtr size, uint allocation, uint protection);
    [DllImport("kernel32.dll")] private static extern bool VirtualFree(IntPtr address, UIntPtr size, uint free);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetOverlappedResult(SafeFileHandle file, ref Overlapped overlapped, out uint read, bool wait);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetFilePointerEx(SafeFileHandle file, long distance, out long position, uint method);

    private static void Report(string command, int reads, long from=0, long to=0, int pending=0)
    {
        using (var self=Process.GetCurrentProcess())
        {
            ulong birth, exit, kernel, user;
            if(!GetProcessTimes(self.Handle,out birth,out exit,out kernel,out user)||birth==0||exit!=0)throw new IOException();
            Console.WriteLine("{\"command\":\""+command+"\",\"pid\":"+self.Id+",\"tid\":"+GetCurrentThreadId()+
                ",\"birth\":\""+birth+"\",\"reads\":"+reads+",\"pending\":"+pending+",\"shareDelete\":"+(fileShare==7?"true":"false")+",\"fromQpc\":\""+from+"\",\"toQpc\":\""+to+"\"}");
        }
    }
    internal static string ProgressMetadata(string command,string stage,int reads)
    {
        if((command!="sync" && command!="async") ||
            !((stage=="accepted" || stage=="opened") && reads==0 ||
              stage=="reading" && reads>0 && reads<=160 && reads%32==0 ||
              stage=="completed" && reads==160))throw new ArgumentException();
        return "AEGIS_READ_PROGRESS/1 "+command+" "+stage+" "+reads.ToString(CultureInfo.InvariantCulture);
    }
    internal static void PaceRead(int completedReads,Func<long> elapsedMilliseconds,Action<int> pause)
    {
        // Read work and late scheduler wakes already consume the observation window.
        long target=completedReads*20L;
        long remaining=target-elapsedMilliseconds();
        while(remaining>0)
        {
            pause((int)remaining);
            remaining=target-elapsedMilliseconds();
        }
    }
    private static int Read(string path, bool asynchronous, int count, bool paced,Action<string,int> progress=null)
    {
        int pending=0;
        IntPtr aligned=asynchronous?VirtualAlloc(IntPtr.Zero,(UIntPtr)4096,0x3000,4):IntPtr.Zero;
        if(asynchronous && aligned==IntPtr.Zero)throw new IOException();
        try {
        using(var file=CreateFile(path,0x80000000,fileShare,IntPtr.Zero,3,asynchronous?0x60000080u:0x80u,IntPtr.Zero))
        using(var signal=new EventWaitHandle(false,EventResetMode.ManualReset))
        {
            if(file.IsInvalid)throw new IOException();
            if(progress!=null)progress("opened",0);
            var buffer=new byte[4096];
            var pacing=Stopwatch.StartNew();
            Func<long> elapsedMilliseconds=()=>pacing.ElapsedMilliseconds;
            Action<int> pause=Thread.Sleep;
            for(int i=0;i<count;i++)
            {
                uint read;
                if(asynchronous)
                {
                    signal.Reset();
                    var overlapped=new Overlapped { Event=signal.SafeWaitHandle.DangerousGetHandle() };
                    bool immediate=ReadFile(file,aligned,4096,out read,ref overlapped);
                    if(!immediate && Marshal.GetLastWin32Error()!=997)throw new IOException();
                    if(!immediate)pending++;
                    if(!GetOverlappedResult(file,ref overlapped,out read,true)||read!=4096)throw new IOException();
                }
                else
                {
                    long position;
                    if(!SetFilePointerEx(file,0,out position,0)||!ReadFile(file,buffer,4096,out read,IntPtr.Zero)||read!=4096)throw new IOException();
                }
                if(progress!=null && (i+1)%32==0)progress("reading",i+1);
                if(paced)PaceRead(i+1,elapsedMilliseconds,pause);
            }
        }
        } finally { if(aligned!=IntPtr.Zero)VirtualFree(aligned,UIntPtr.Zero,0x8000); }
        return pending;
    }
    private static int Main(string[] args) { try { return Run(args); } catch { return 2; } }
    private static int Run(string[] args)
    {
        if(args.Length<1 || !Path.IsPathRooted(args[0]) || new FileInfo(args[0]).Length!=4096)return 3;
        if(args.Length==2 && args[1]=="deny-delete-share")fileShare=3;
        using(var timer=new Timer(_=>Environment.Exit(71),null,240000,Timeout.Infinite))
        {
            if(args.Length==2 && args[1]=="short") { Report("ready",0); long from=Stopwatch.GetTimestamp(); Read(args[0],false,64,false); Report("short",64,from,Stopwatch.GetTimestamp()); return 0; }
            // Hold a system-only loader reference before Ready; no window is probed or warmed up.
            PreloadWindowDpi((name,flags)=>LoadLibraryEx(name,IntPtr.Zero,flags));
            Report("ready",0);
            string command;
            while((command=Console.ReadLine())!=null)
            {
                if(command=="exit")return 0;
                DpiMetadata dpi;
                if(TryWindowDpi(command,WindowExists,WindowIdentity,WindowDpi,out dpi)) { Console.WriteLine(dpi.ToJson());continue; }
                if(command!="sync" && command!="async")return 3;
                Action<string,int> progress=(stage,reads)=>Console.Error.WriteLine(ProgressMetadata(command,stage,reads));
                progress("accepted",0);
                long from=Stopwatch.GetTimestamp();
                int pending=Read(args[0],command=="async",160,true,progress);
                progress("completed",160);
                Report(command,160,from,Stopwatch.GetTimestamp(),pending);
            }
        }
        return 0;
    }
}
