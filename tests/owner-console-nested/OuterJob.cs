using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Fixture only: starts a node runner suspended and subjects its entire tree to
// a separately retained kill-on-close Job before allowing the runner to execute.
internal static class OuterJob
{
    [StructLayout(LayoutKind.Sequential)] private struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Io { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] private struct Extended { public Basic basic; public Io io; public UIntPtr a,b,c,d; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup { public int cb; public string a,b,c; public uint x,y,xs,ys,xc,yc,fill,flags; public short show,reserved; public IntPtr ptr,stdin,stdout,stderr; }
    [StructLayout(LayoutKind.Sequential)] private struct Child { public IntPtr process,thread; public uint pid,tid; }
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr a,string n);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool SetInformationJobObject(IntPtr h,int c,ref Extended i,uint n);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string dir,ref Startup startup,out Child child);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle,uint ms);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    private static void Check(bool value,string name) { if(!value) throw new Exception(name+" win32="+Marshal.GetLastWin32Error()); }
    private static string Quote(string value) { return "\""+value.Replace("\"","\\\"")+"\""; }
    private static int Main(string[] args)
    {
        if(args.Length!=5) return 2;
        IntPtr job=IntPtr.Zero; Child child=new Child();
        try {
            job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero,"create-job");
            Extended info=new Extended(); info.basic.flags=0x2000;
            Check(SetInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(typeof(Extended))),"job-limit");
            Startup startup=new Startup(); startup.cb=Marshal.SizeOf(typeof(Startup));
            string command=Quote(args[0])+" "+Quote(args[1])+" "+Quote(args[2])+" "+Quote(args[3])+" "+Quote(args[4]);
            Check(CreateProcess(args[0],new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,4|0x08000000,IntPtr.Zero,null,ref startup,out child),"create-runner");
            if(!AssignProcessToJobObject(job,child.process)){TerminateProcess(child.process,2);Check(false,"assign-job");}
            File.WriteAllText(Path.Combine(args[3],args[4]+"-runner-pid.txt"),child.pid.ToString());
            Check(ResumeThread(child.thread)!=0xffffffff,"resume");
            Check(WaitForSingleObject(child.process,15000)==0,"runner-timeout");
            uint code; Check(GetExitCodeProcess(child.process,out code),"runner-exit"); return (int)code;
        } catch(Exception error) { File.WriteAllText(Path.Combine(args[3],args[4]+"-outer-error.txt"),error.Message); return 2; }
        finally { if(child.thread!=IntPtr.Zero)CloseHandle(child.thread); if(child.process!=IntPtr.Zero)CloseHandle(child.process); if(job!=IntPtr.Zero)CloseHandle(job); }
    }
}
