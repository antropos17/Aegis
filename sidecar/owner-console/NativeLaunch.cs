using System;
using System.Collections;
using System.Collections.Generic;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal static class NativeLaunch
{
    internal const uint Suspended = 4, UnicodeEnvironment = 0x400, ExtendedStartup = 0x80000;
    private const uint DuplicateSameAccess = 2;
    [StructLayout(LayoutKind.Sequential)] private struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Counters { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] private struct Extended { public Basic basic; public Counters io; public UIntPtr a,b,c,d; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct Startup { public int size; public string reserved,desktop,title; public uint x,y,xsize,ysize,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr ptr,input,output,error; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupEx { public Startup startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr a,string n);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool SetInformationJobObject(IntPtr job,int cls,ref Extended info,uint size);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr copy,uint access,bool inherit,uint options);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="CreateProcessW")]
    private static extern bool CreateProcess(string app,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);

    internal sealed class Child : IDisposable
    {
        internal IntPtr Handle; internal uint Id;
        internal bool Exited { get { return WaitForSingleObject(Handle,0)==0; } }
        internal uint ExitCode { get { uint code; Need(GetExitCodeProcess(Handle,out code)); return code; } }
        internal bool Wait(int ms) { return WaitForSingleObject(Handle,(uint)ms)==0; }
        internal bool Stop(int ms) { if(!Exited) TerminateProcess(Handle,2); return Wait(ms); }
        public void Dispose() { if (Handle!=IntPtr.Zero) { CloseHandle(Handle); Handle=IntPtr.Zero; } }
    }

    internal static SafeFileHandle NewJob()
    {
        IntPtr handle=CreateJobObject(IntPtr.Zero,null); Need(handle!=IntPtr.Zero);
        var job=new SafeFileHandle(handle,true); Extended limits=new Extended(); limits.basic.flags=0x2000;
        if(!SetInformationJobObject(handle,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended)))) { job.Dispose(); throw new InvalidOperationException("job limits"); }
        return job;
    }

    internal static IntPtr InheritableDuplicate(IntPtr original)
    {
        IntPtr copy; IntPtr current=GetCurrentProcess(); Need(DuplicateHandle(current,original,current,out copy,0,true,DuplicateSameAccess)); return copy;
    }

    // C runtime compatible quoting, including trailing backslashes before a quote.
    internal static string Quote(string value)
    {
        var text=new StringBuilder("\""); int slash=0;
        foreach(char c in value) {
            if(c=='\\') { slash++; continue; }
            if(c=='\"') { text.Append('\\',slash*2+1); text.Append(c); slash=0; continue; }
            text.Append('\\',slash); slash=0; text.Append(c);
        }
        text.Append('\\',slash*2); return text.Append('"').ToString();
    }

    internal static Dictionary<string,string> MinimalEnvironment()
    {
        var result=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        foreach(string key in new[]{"SystemRoot","WINDIR","TEMP","TMP"}) {
            string value=Environment.GetEnvironmentVariable(key);
            if(!String.IsNullOrEmpty(value)) result[key]=value;
        }
        return result;
    }

    private static IntPtr EnvironmentBlock(IDictionary<string,string> values)
    {
        var keys=new List<string>(values.Keys); keys.Sort(StringComparer.OrdinalIgnoreCase); var block=new StringBuilder();
        foreach(string key in keys) { if(key.IndexOf('=')>=0 || key.IndexOf('\0')>=0 || values[key].IndexOf('\0')>=0) throw new InvalidOperationException("environment"); block.Append(key).Append('=').Append(values[key]).Append('\0'); }
        block.Append('\0'); return Marshal.StringToHGlobalUni(block.ToString());
    }

    internal static Child Start(string executable,string[] args,IDictionary<string,string> environment,SafeFileHandle job,IntPtr[] handles,IntPtr input,IntPtr output,IntPtr error,Action<IntPtr,uint> beforeResume)
    {
        var command=new StringBuilder(Quote(executable)); foreach(string arg in args) command.Append(' ').Append(Quote(arg));
        IntPtr env=EnvironmentBlock(environment), list=IntPtr.Zero, memory=IntPtr.Zero, jobMemory=IntPtr.Zero; bool initialized=false;
        try {
            StartupEx start=new StartupEx(); start.startup.size=Marshal.SizeOf(typeof(StartupEx)); uint flags=Suspended|UnicodeEnvironment|ExtendedStartup;
            IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,handles==null?1:2,0,ref size); Need(size!=IntPtr.Zero);
            list=Marshal.AllocHGlobal(size); Need(InitializeProcThreadAttributeList(list,handles==null?1:2,0,ref size)); initialized=true;
            jobMemory=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobMemory,job.DangerousGetHandle());
            Need(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000d),jobMemory,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
            start.attributes=list;
            if(handles!=null) {
                start.startup.flags=0x100; start.startup.input=input; start.startup.output=output; start.startup.error=error;
                memory=Marshal.AllocHGlobal(handles.Length*IntPtr.Size); Marshal.Copy(handles,0,memory,handles.Length);
                Need(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),memory,new IntPtr(handles.Length*IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
            }
            ProcessInfo process; Need(CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,handles!=null,flags,env,null,ref start,out process));
            try {
                bool inJob; if(!IsProcessInJob(process.process,job.DangerousGetHandle(),out inJob) || !inJob) throw new InvalidOperationException("job assignment failed");
                if(beforeResume!=null) beforeResume(process.process,process.pid);
                if(ResumeThread(process.thread)==0xffffffff) { TerminateProcess(process.process,2); throw new InvalidOperationException("resume failed"); }
                return new Child { Handle=process.process,Id=process.pid };
            } catch {
                TerminateProcess(process.process,2);
                bool stopped=WaitForSingleObject(process.process,3000)==0;
                CloseHandle(process.process);
                if(!stopped) throw new InvalidOperationException("child termination unconfirmed");
                throw;
            } finally { CloseHandle(process.thread); }
        } finally { if(initialized)DeleteProcThreadAttributeList(list); if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list); if(memory!=IntPtr.Zero)Marshal.FreeHGlobal(memory); if(jobMemory!=IntPtr.Zero)Marshal.FreeHGlobal(jobMemory); Marshal.FreeHGlobal(env); }
    }

    private static void Need(bool ok) { if(!ok) throw new InvalidOperationException("native process failure"); }
}
