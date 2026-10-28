using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// A separate attacker process probes only disposable task-owned directories.
internal static class AttributeProbe
{
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool DeviceIoControl(SafeFileHandle handle,uint code,byte[] input,uint length,IntPtr output,uint outputLength,out uint returned,IntPtr overlapped);
    private static readonly string Base=AppDomain.CurrentDomain.BaseDirectory;
    private static void Need(bool value,string reason){if(!value)throw new Exception(reason+" win32="+Marshal.GetLastWin32Error());}
    private static string Q(string s){return "\""+s+"\"";}
    private static byte[] Data(string target)
    {
        byte[] a=Encoding.Unicode.GetBytes(@"\??\"+target),b=Encoding.Unicode.GetBytes(target),data=new byte[16+a.Length+2+b.Length+2];
        Array.Copy(BitConverter.GetBytes(0xa0000003u),0,data,0,4);Array.Copy(BitConverter.GetBytes((ushort)(data.Length-8)),0,data,4,2);
        Array.Copy(BitConverter.GetBytes((ushort)a.Length),0,data,10,2);Array.Copy(BitConverter.GetBytes((ushort)(a.Length+2)),0,data,12,2);Array.Copy(BitConverter.GetBytes((ushort)b.Length),0,data,14,2);
        Array.Copy(a,0,data,16,a.Length);Array.Copy(b,0,data,18+a.Length,b.Length);return data;
    }
    private static bool Set(SafeFileHandle handle,byte[] data){uint n;return DeviceIoControl(handle,0x900a4,data,(uint)data.Length,IntPtr.Zero,0,out n,IntPtr.Zero);}
    private static void Remove(SafeFileHandle handle){byte[] data=new byte[8];Array.Copy(BitConverter.GetBytes(0xa0000003u),data,4);uint n;Need(DeviceIoControl(handle,0x900ac,data,8,IntPtr.Zero,0,out n,IntPtr.Zero),"remove fixture reparse point");}
    private static string Hash(string path){using(var hash=SHA256.Create())using(var stream=File.OpenRead(path))return BitConverter.ToString(hash.ComputeHash(stream));}
    private static void Profile(string path){foreach(string child in new[]{"appdata","localappdata","userprofile","home","temp"}){string dir=Path.Combine(path,child);Directory.CreateDirectory(dir);File.WriteAllText(Path.Combine(dir,".aegis-owner-profile-anchor"),"immutable owned fixture marker "+child);}}
    private static void Signal(string path,string value){File.WriteAllText(path+".pending",value);File.Move(path+".pending",path);}
    private static void Wait(string path,Process child){Stopwatch t=Stopwatch.StartNew();while(!File.Exists(path)&&t.ElapsedMilliseconds<5000){if(child!=null&&child.HasExited)throw new Exception("probe child exited before "+Path.GetFileName(path));Thread.Sleep(10);}Need(File.Exists(path),"probe handshake timeout");}
    private static int Attempt(string[] args)
    {
        string dir=args[1],target=args[2],prefix=args[3],marker=args[4];uint access=args[5]=="attribute"?0x100u:0x40000000u;
        using(SafeFileHandle handle=CreateFile(dir,access,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            bool opened=!handle.IsInvalid;int openError=opened?0:Marshal.GetLastWin32Error();Signal(prefix+".opened",opened+","+openError);
            Wait(prefix+".execute",null);
            bool set=opened&&Set(handle,Data(target));int setError=set?0:opened?Marshal.GetLastWin32Error():-1;
            string deletion="not-run",rename="not-run";
            if(marker!="none") {
                string moved=marker+".moved";byte[] original=File.ReadAllBytes(marker);
                try {File.Delete(marker);deletion=File.Exists(marker)?"present":"allowed";if(!File.Exists(marker))File.WriteAllBytes(marker,original);} catch(Exception e){deletion="denied:"+(e.HResult&0xffff);}
                try {File.Move(marker,moved);rename="allowed";File.Move(moved,marker);} catch(Exception e){rename="denied:"+(e.HResult&0xffff);}
            }
            Signal(prefix+".outcome","opened="+opened+" openError="+openError+" set="+set+" setError="+setError+" delete="+deletion+" rename="+rename);
            Wait(prefix+".finish",null);if(set)Remove(handle);
        }
        return 0;
    }
    private static string Run(string name,string root,string target,bool pin,bool preopen,bool marker,string access)
    {
        string home=Path.Combine(root,"home"),markerPath=marker?Path.Combine(home,".aegis-owner-profile-anchor"):"none",prefix=Path.Combine(Base,name),hash=null;
        ProfileIsolation profile=null;Process child=null;bool detected=false;
        if(marker)hash=Hash(markerPath);
        try {
            if(pin&&!preopen)profile=ProfileIsolation.Open(root);
            string exe=Process.GetCurrentProcess().MainModule.FileName;
            var start=new ProcessStartInfo(exe,"attempt "+Q(home)+" "+Q(target)+" "+Q(prefix)+" "+Q(markerPath)+" "+access);start.UseShellExecute=false;start.CreateNoWindow=true;
            child=Process.Start(start);Wait(prefix+".opened",child);string opened=File.ReadAllText(prefix+".opened");
            if(pin&&preopen){try{profile=ProfileIsolation.Open(root);}catch{Signal(prefix+".execute","go");Wait(prefix+".outcome",child);Signal(prefix+".finish","done");child.WaitForExit(5000);return name+" pinRefused=true "+opened;}}
            Signal(prefix+".execute","go");Wait(prefix+".outcome",child);string outcome=File.ReadAllText(prefix+".outcome");
            if(profile!=null && outcome.Contains("set=True")){try{profile.Validate();}catch{detected=true;}}
            Signal(prefix+".finish","done");Need(child.WaitForExit(5000)&&child.ExitCode==0,"probe child cleanup");
            if(marker)Need(Hash(markerPath)==hash,"marker content changed");
            string result=name+" pinRefused=false "+outcome+" validateDetected="+detected+" markerHashStable="+(!marker||Hash(markerPath)==hash);
            File.WriteAllText(Path.Combine(Base,name+".result"),result);Console.WriteLine(result);return result;
        } finally {if(child!=null){if(!child.HasExited){child.Kill();child.WaitForExit(5000);}child.Dispose();}if(profile!=null)profile.Dispose();}
    }
    private static int Main(string[] args)
    {
        try {
            if(args.Length==6 && args[0]=="attempt")return Attempt(args);
            string taskRoot=Directory.GetParent(Base.TrimEnd(Path.DirectorySeparatorChar)).FullName;
            string scratch=Path.Combine(taskRoot,"owner-console-profile-data","attributes-"+Guid.NewGuid().ToString("N"));
            string protect=Path.Combine(scratch,"protected"),target=Path.Combine(scratch,"target");Directory.CreateDirectory(protect);Directory.CreateDirectory(target);
            ProfileIsolation.ProtectedPathsForTest=delegate{return new[]{protect};};ProfileIsolation.BeforeValidationForTest=delegate{};
            string control=Path.Combine(scratch,"control"),empty=Path.Combine(scratch,"empty"),pre=Path.Combine(scratch,"pre"),marked=Path.Combine(scratch,"marked"),generic=Path.Combine(scratch,"generic");
            Directory.CreateDirectory(Path.Combine(control,"home"));foreach(string path in new[]{empty,pre,marked,generic})Profile(path);
            string result=Run("control",control,target,false,false,false,"attribute");Need(result.Contains("opened=True")&&result.Contains("set=True"),"unpinned attribute FSCTL control");
            string after=Run("anchor-postpin",empty,target,true,false,true,"attribute");Need(after.Contains("opened=True")&&after.Contains("set=False setError=145")&&after.Contains("delete=denied:32 rename=denied:32")&&after.Contains("markerHashStable=True"),"anchor postpin behavior");
            string before=Run("anchor-preopen",pre,target,true,true,true,"attribute");Need(before.Contains("pinRefused=false")&&before.Contains("opened=True")&&before.Contains("set=False setError=145")&&before.Contains("delete=denied:32 rename=denied:32"),"anchor preopen behavior");
            string repeated=Run("marker-attribute",marked,target,true,false,true,"attribute");Need(repeated.Contains("set=False setError=145")&&repeated.Contains("markerHashStable=True"),"anchor attribute behavior");
            string other=Run("marker-generic",generic,target,true,false,true,"generic");Need(other.Contains("opened=False openError=32")&&other.Contains("delete=denied:32 rename=denied:32"),"anchor generic behavior");
            return 0;
        } catch(Exception error){File.WriteAllText(Path.Combine(Base,args.Length>0?"attributes-child.failure":"attributes.failure"),error.ToString());Console.Error.WriteLine(error.Message);return 1;}
    }
}
