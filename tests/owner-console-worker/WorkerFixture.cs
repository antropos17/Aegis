using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

// This fixture creates its own hidden console. It never touches the invoking
// user's console or settings. Compile with the worker source into one test exe.
internal static class WorkerFixture
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct Startup { public int cb; public string a,b,c; public uint x,y,xs,ys,xc,yc,fill,flags; public short show,reserved; public IntPtr ptr,stdin,stdout,stderr; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Explicit, Size=20)]
    private struct Input { [FieldOffset(0)] public ushort type; [FieldOffset(4)] public int down; [FieldOffset(8)] public ushort repeat; [FieldOffset(10)] public ushort vk; [FieldOffset(14)] public char ch; [FieldOffset(16)] public uint controls; }
    [StructLayout(LayoutKind.Sequential)] private struct Coord { public short x,y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public short left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct BufferInfo { public Coord size,cursor; public ushort attributes; public Rect window; public Coord maximum; }
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool DuplicateHandle(IntPtr source,IntPtr value,IntPtr target,out IntPtr result,uint access,bool inherit,uint options);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle,uint ms);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool TerminateProcess(IntPtr handle,uint code);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string dir,ref Startup start,out ProcessInformation process);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool WriteConsoleInput(IntPtr handle,Input[] values,uint length,out uint written);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetConsoleScreenBufferInfo(IntPtr handle,out BufferInfo info);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool ReadConsoleOutputCharacter(IntPtr handle,[Out] char[] chars,uint length,Coord location,out uint read);
    private static string directory = AppDomain.CurrentDomain.BaseDirectory;
    private const string Challenge = "0123456789abcdef0123456789abcdef";
    private const string Probe1 = "11111111111111111111111111111111";
    private const string Probe2 = "22222222222222222222222222222222";
    private static void Need(bool value, string why) { if (!value) throw new Exception(why + " win32=" + Marshal.GetLastWin32Error()); }
    private static string Q(string value) { return "\"" + value + "\""; }

    private static int Main(string[] args)
    {
        try
        {
            if (args[0] == "worker")
            {
                IntPtr input = new IntPtr(Int64.Parse(Environment.GetEnvironmentVariable("AEGIS_OWNER_CONSOLE_IN")));
                IntPtr error = GetStdHandle(-12);
                if (args[1] == "closed-output") CloseHandle(error);
                if (args[1] == "closed-input") CloseHandle(input);
#if OWNER_CONSOLE_TEST
                if (args[1] == "blocked-write") ConsoleWorker.BeforeWriteForTest = delegate { File.WriteAllText(Path.Combine(directory,"blocked-write.marker"),"ready"); Thread.Sleep(30000); };
                if (args[1] == "blocked-read") ConsoleWorker.BeforeInputReadForTest = delegate { File.WriteAllText(Path.Combine(directory,"blocked-read.marker"),"ready"); Thread.Sleep(30000); };
                if (args[1] == "probe-overlap") ConsoleWorker.BeforeWriteForTest = delegate { File.WriteAllText(Path.Combine(directory,"probe-overlap.marker"),"ready"); Thread.Sleep(500); };
                if (args[1] == "probe-interleaved") ConsoleWorker.BeforeProbeCheckForTest = delegate {
                    ConsoleWorker.BeforeProbeCheckForTest = null;
                    File.WriteAllText(Path.Combine(directory,"probe-interleaved.marker"),"ready");
                    string release=Path.Combine(directory,"probe-interleaved.release");
                    for(int i=0;i<300;i++) { if(File.Exists(release))return; Thread.Sleep(10); }
                    throw new Exception("fixture release timeout");
                };
#endif
                if (args[1] == "disclosure")
                    return ConsoleWorker.Run(input,error,Console.OpenStandardInput(),Console.OpenStandardOutput(),CreateDisclosure());
                return ConsoleWorker.Run(input,error,Console.OpenStandardInput(),Console.OpenStandardOutput());
            }
            if (args[0] == "fixture") { Fixture(args[1]); return 0; }
            Outer(args[1]); return 0;
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(directory,args[1]+".failure"), error.ToString());
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static void Outer(string scenario)
    {
        string failure = Path.Combine(directory,scenario+".failure");
        File.Delete(failure);
        File.Delete(Path.Combine(directory,scenario+".marker"));
        File.Delete(Path.Combine(directory,scenario+".release"));
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        Startup start = new Startup(); start.cb=Marshal.SizeOf(typeof(Startup)); start.flags=1; start.show=0;
        ProcessInformation process;
        Need(CreateProcess(exe,new StringBuilder(Q(exe)+" fixture "+scenario),IntPtr.Zero,IntPtr.Zero,false,0x10,IntPtr.Zero,directory,ref start,out process),"create console fixture");
        CloseHandle(process.thread);
        try
        {
            if (WaitForSingleObject(process.process,8000) != 0) { TerminateProcess(process.process,1); throw new Exception("fixture timed out"); }
            uint code; Need(GetExitCodeProcess(process.process,out code),"fixture exit code");
            Need(code == 0,File.Exists(failure) ? File.ReadAllText(failure) : "fixture failed");
        }
        finally { CloseHandle(process.process); }
        Console.WriteLine("PASS " + scenario);
    }

    private static void Fixture(string scenario)
    {
        IntPtr input = GetStdHandle(-10), error = GetStdHandle(-12), duplicate;
        Need(DuplicateHandle(GetCurrentProcess(),input,GetCurrentProcess(),out duplicate,0,true,2),"duplicate input");
        if (scenario == "early") Inject(input,"x");
        BufferInfo before; Need(GetConsoleScreenBufferInfo(error,out before),"console info");
        ProcessStartInfo start = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"worker " + scenario);
        start.UseShellExecute=false; start.RedirectStandardInput=true; start.RedirectStandardOutput=true; start.RedirectStandardError=false;
        start.EnvironmentVariables["AEGIS_OWNER_CONSOLE_IN"] = duplicate.ToInt64().ToString();
        using (Process worker = Process.Start(start))
        {
            CloseHandle(duplicate);
            try
            {
                Stream read = worker.StandardOutput.BaseStream, write=worker.StandardInput.BaseStream;
                if (scenario == "early" || scenario == "closed-output" || scenario == "closed-input") { Need(ReadFrame(read)=="L","startup must fail"); return; }
                Need(ReadFrame(read)=="H 1","ready frame");
                if (scenario == "idle") { Inject(input,"x"); Need(ReadFrame(read)=="L","idle input must revoke"); return; }
                if (scenario == "probe-idle") { Probe(write,read,Probe1); Probe(write,read,Probe2); return; }
                if (scenario == "probe-invalid") { WriteFrame(write,"T NOT-A-NONCE"); Need(ReadFrame(read)=="L","invalid probe must fail"); return; }
                if (scenario == "probe-replay") { Probe(write,read,Probe1); WriteFrame(write,"T "+Probe1); Need(ReadFrame(read)=="L","replayed probe must fail"); return; }
                if (scenario == "keyup-flood") { InjectReleases(input,300); Need(ReadFrame(read)=="L","keyup flood must fail closed"); return; }
                if (scenario == "invalid-preview") { WriteFrame(write,"R "+Challenge+" Gwo="); Need(ReadFrame(read)=="L","invalid preview must fail"); return; }
                if (scenario == "invalid-cr" || scenario == "invalid-nul" || scenario == "invalid-esc")
                {
                    byte invalid=(byte)(scenario=="invalid-cr"?13:scenario=="invalid-nul"?0:27);
                    WriteFrame(write,"R "+Challenge+" "+Convert.ToBase64String(new byte[]{(byte)'x',invalid,(byte)'y'}));
                    Need(ReadFrame(read)=="L","control byte must fail"); return;
                }
                if (scenario == "oversized") { write.WriteByte(1); write.WriteByte(96); write.WriteByte(0); write.WriteByte(0); write.Flush(); Need(ReadFrame(read)=="L","oversized frame must fail"); return; }
                string preview=Convert.ToBase64String(Encoding.ASCII.GetBytes(scenario == "max-preview" ? new string('p',16384) : scenario == "preview-too-large" ? new string('p',16385) : scenario == "multiline" ? "first\nsecond" : "escaped preview"));
                WriteFrame(write,"R "+Challenge+" "+preview);
                if (scenario == "preview-too-large") { Need(ReadFrame(read)=="L","oversized preview must fail"); return; }
                if (scenario == "blocked-write") { WaitMarker(scenario); WriteFrame(write,"T "+Probe1); AssertNoFrame(read); return; }
                if (scenario == "probe-overlap") { WaitMarker(scenario); WriteFrame(write,"T "+Probe1); WriteFrame(write,"T "+Probe2); Need(ReadFrame(read)=="U "+Challenge,"overlapping probes must fail closed"); return; }
                WaitForPrompt(error,before);
                if (scenario == "multiline")
                {
                    Need(ReadAt(error,before.cursor,5)=="first","first preview line");
                    Coord next=new Coord(); next.x=0; next.y=(short)(before.cursor.y+1);
                    Need(ReadAt(error,next,6)=="second","second preview line begins at column zero");
                }
                if (scenario == "disclosure")
                {
                    string[] lines=DisclosureLines();
                    string disclosure=CreateDisclosure();
                    Need(disclosure==String.Join("\r\n",lines)+"\r\n","exact escaped disclosure");
                    string hostile="\u001b\r\n\"\\";
                    string escaped=(string)typeof(ProfileIsolation).GetMethod("Escape",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic).Invoke(null,new object[]{hostile});
                    Need(escaped==@"\u001b\u000d\u000a"+"\\\""+@"\\","control and quote escaping");
                    foreach(char c in disclosure) Need(c=='\r' || c=='\n' || (c>=0x20 && c<=0x7e),"disclosure control injection");
                    for(int i=0;i<lines.Length;i++)
                    {
                        Coord position=new Coord(); position.x=(short)(i==0?before.cursor.x:0); position.y=(short)(before.cursor.y+i);
                        Need(ReadAt(error,position,lines[i].Length)==lines[i],"disclosure line "+i);
                    }
                    Coord operation=new Coord(); operation.x=0; operation.y=(short)(before.cursor.y+lines.Length);
                    Need(ReadAt(error,operation,"escaped preview".Length)=="escaped preview","preview follows disclosure");
                    Coord prompt=new Coord(); prompt.x=0; prompt.y=(short)(operation.y+1);
                    string challengePrompt="Type DELETE "+Challenge;
                    Need(ReadAt(error,prompt,challengePrompt.Length)==challengePrompt,"challenge follows preview");
                }
                Thread.Sleep(100);
                if (scenario == "probe-during") Probe(write,read,Probe1);
                if (scenario == "probe-interleaved")
                {
                    WriteFrame(write,"T "+Probe1);
                    WaitMarker(scenario);
                    Inject(input,"D");
                    File.WriteAllText(Path.Combine(directory,scenario+".release"),"go");
                    Need(ReadFrame(read)=="Z "+Probe1,"probe must wait for interleaved key");
                    Inject(input,"ELETE "+Challenge+"\r");
                    Need(ReadFrame(read)=="A "+Challenge,"interleaved prompt must approve exact answer");
                    return;
                }
                if (scenario == "blocked-read") { Inject(input,"x"); WaitMarker(scenario); WriteFrame(write,"T "+Probe1); AssertNoFrame(read); return; }
                if (scenario == "cancel-wait") return;
                if (scenario == "trailing") { Inject(input,"DELETE "+Challenge+"\rx"); Need(ReadFrame(read)=="D "+Challenge,"trailing must fail"); return; }
                if (scenario == "wrong") { Inject(input,"NO\r"); Need(ReadFrame(read)=="D "+Challenge,"wrong response must fail"); return; }
                if (scenario == "overlong") { Inject(input,new string('a',40)); Need(ReadFrame(read)=="D "+Challenge,"overlong response must fail"); return; }
                Inject(input,"DELETE "+Challenge+"\r");
                Need(ReadFrame(read)=="A "+Challenge,"approval frame");
                if (scenario == "after") { Inject(input,"x"); Need(ReadFrame(read)=="V "+Challenge,"postapproval input must revoke"); }
                if (scenario == "probe-after") Probe(write,read,Probe1);
                if (scenario == "probe-after-input") { Inject(input,"x"); WriteFrame(write,"T "+Probe1); Need(ReadFrame(read)=="V "+Challenge,"queued input must revoke before health response"); }
            }
            finally
            {
                if (!worker.HasExited) worker.Kill();
                Need(worker.WaitForExit(3000),"worker termination");
            }
        }
    }

    private static void WaitForPrompt(IntPtr error,BufferInfo initial)
    {
        for(int i=0;i<150;i++) { BufferInfo now; Need(GetConsoleScreenBufferInfo(error,out now),"console info"); if(now.cursor.x!=initial.cursor.x || now.cursor.y!=initial.cursor.y) return; Thread.Sleep(20); }
        throw new Exception("prompt timeout");
    }
    private static string ReadAt(IntPtr error,Coord location,int length)
    {
        char[] chars=new char[length]; uint count;
        Need(ReadConsoleOutputCharacter(error,chars,(uint)length,location,out count) && count==length,"read console output");
        return new string(chars);
    }
    private static string CreateDisclosure()
    {
        using(ProfileIsolation profile=new ProfileIsolation())
        {
            // Set a synthetic root only to exercise the pure display formatter;
            // this fixture does not open or alter a profile directory.
            typeof(ProfileIsolation).GetProperty("Root",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)
                .GetSetMethod(true).Invoke(profile,new object[]{"X:\\fixture-%USERPROFILE%-\u0394"});
            return profile.Disclosure;
        }
    }
    private static string[] DisclosureLines()
    {
        return new[]{
            @"Selected profile root: X:\\fixture-%USERPROFILE%-\u0394",
            @"APPDATA: X:\\fixture-%USERPROFILE%-\u0394\\appdata",
            @"LOCALAPPDATA: X:\\fixture-%USERPROFILE%-\u0394\\localappdata",
            @"USERPROFILE: X:\\fixture-%USERPROFILE%-\u0394\\userprofile",
            @"HOME: X:\\fixture-%USERPROFILE%-\u0394\\home",
            @"TEMP and TMP: X:\\fixture-%USERPROFILE%-\u0394\\temp"
        };
    }
    private static void Inject(IntPtr input,string value)
    {
        Input[] records=new Input[value.Length*2];
        for(int i=0;i<value.Length;i++)
        {
            records[2*i].type=1; records[2*i].down=1; records[2*i].repeat=1; records[2*i].ch=value[i]; records[2*i].vk=(ushort)(value[i]=='\r'?13:char.ToUpperInvariant(value[i]));
            records[2*i+1]=records[2*i]; records[2*i+1].down=0;
        }
        uint written; Need(WriteConsoleInput(input,records,(uint)records.Length,out written) && written==records.Length,"inject");
    }
    private static void InjectReleases(IntPtr input,int length)
    {
        Input[] records=new Input[length];
        for(int i=0;i<length;i++){records[i].type=1;records[i].down=0;records[i].repeat=1;records[i].vk=65;records[i].ch='a';}
        uint written; Need(WriteConsoleInput(input,records,(uint)length,out written) && written==length,"inject key releases");
    }
    private static void Probe(Stream write,Stream read,string nonce)
    {
        WriteFrame(write,"T "+nonce); Need(ReadFrame(read)=="Z "+nonce,"probe response");
    }
    private static void WaitMarker(string scenario)
    {
        string marker=Path.Combine(directory,scenario+".marker");
        for(int i=0;i<150;i++){if(File.Exists(marker))return;Thread.Sleep(20);}
        throw new Exception("blocked worker marker timeout");
    }
    private static void AssertNoFrame(Stream stream)
    {
        Task<int> read=Task.Run(delegate { return stream.ReadByte(); });
        if(read.Wait(250)) throw new Exception("worker falsely answered while monitor loop was blocked");
    }
    private static void WriteFrame(Stream stream,string value)
    {
        byte[] bytes=Encoding.ASCII.GetBytes(value); stream.WriteByte((byte)bytes.Length); stream.WriteByte((byte)(bytes.Length>>8)); stream.WriteByte((byte)(bytes.Length>>16)); stream.WriteByte((byte)(bytes.Length>>24)); stream.Write(bytes,0,bytes.Length); stream.Flush();
    }
    private static string ReadFrame(Stream stream)
    {
        Task<string> read=Task.Run(delegate { int a=stream.ReadByte(),b=stream.ReadByte(),c=stream.ReadByte(),d=stream.ReadByte(); if(a<0||b<0||c<0||d<0)throw new IOException("EOF"); int n=a|(b<<8)|(c<<16)|(d<<24); if(n<1||n>24576)throw new IOException("length"); byte[] bytes=new byte[n]; int offset=0; while(offset<n){int count=stream.Read(bytes,offset,n-offset);if(count<=0)throw new IOException("EOF");offset+=count;} return Encoding.ASCII.GetString(bytes); });
        if(!read.Wait(3000))throw new Exception("frame timeout"); return read.Result;
    }
}
