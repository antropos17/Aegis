using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// A normal-token, independently witnessed read initiator. Never invokes a provider,
// reads a user path or logs the synthetic file contents. The caller owns this process.
internal static class EtwReadProcess
{
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
    private static int Read(string path, bool asynchronous, int count, bool paced)
    {
        int pending=0;
        IntPtr aligned=asynchronous?VirtualAlloc(IntPtr.Zero,(UIntPtr)4096,0x3000,4):IntPtr.Zero;
        if(asynchronous && aligned==IntPtr.Zero)throw new IOException();
        try {
        using(var file=CreateFile(path,0x80000000,fileShare,IntPtr.Zero,3,asynchronous?0x60000080u:0x80u,IntPtr.Zero))
        using(var signal=new EventWaitHandle(false,EventResetMode.ManualReset))
        {
            if(file.IsInvalid)throw new IOException();
            var buffer=new byte[4096];
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
                if(paced)Thread.Sleep(20);
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
            Report("ready",0);
            string command;
            while((command=Console.ReadLine())!=null)
            {
                if(command=="exit")return 0;
                if(command!="sync" && command!="async")return 3;
                long from=Stopwatch.GetTimestamp();
                int pending=Read(args[0],command=="async",160,true);
                Report(command,160,from,Stopwatch.GetTimestamp(),pending);
            }
        }
        return 0;
    }
}
