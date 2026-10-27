using System;
using System.Diagnostics;
using System.IO;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

// Every created object is a disposable fixture under this executable's own
// task-temp directory. No existing user profile is used or modified.
internal static class ProfileFixture
{
    private static readonly string Base=AppDomain.CurrentDomain.BaseDirectory;
    private static readonly string[] Names={"appdata","localappdata","userprofile","home","temp"};
    private static string Scratch;
    private static void Need(bool value,string reason) {if(!value)throw new Exception(reason);}
    private static void Reject(string path,string reason)
    {
        try {using(var profile=ProfileIsolation.Open(path)){profile.Validate();}}
        catch {return;}
        throw new Exception("accepted "+reason);
    }
    private static void CreateProfile(string root)
    {
        Directory.CreateDirectory(root);foreach(string name in Names)Directory.CreateDirectory(Path.Combine(root,name));
    }
    private static string Hash(string path)
    {
        using(var algorithm=SHA256.Create())
        using(var input=File.OpenRead(path))
            return BitConverter.ToString(algorithm.ComputeHash(input));
    }
    private static void RefuseMove(string source,string target,string reason)
    {
        bool moved=false;Exception error=null;
        var thread=new Thread(delegate() {
            try {Directory.Move(source,target);moved=true;}
            catch(Exception ex) {error=ex;}
        });
        thread.IsBackground=true;thread.Start();Need(thread.Join(3000),reason+" rename timed out");
        if(moved) {Directory.Move(target,source);throw new Exception(reason+" rename was allowed");}
        Need(error is IOException || error is UnauthorizedAccessException,reason+" unexpected rename error");
        Need(Directory.Exists(source) && !Directory.Exists(target),reason+" original path changed");
    }
    private static bool Junction(string link,string target)
    {
        var start=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"cmd.exe"),"/d /c mklink /J \""+link+"\" \""+target+"\"");
        start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
        using(Process process=Process.Start(start)) {if(!process.WaitForExit(3000)){process.Kill();throw new Exception("junction command timeout");}return process.ExitCode==0;}
    }
    private static int Main()
    {
        try {
            string data=Path.Combine(Directory.GetParent(Base.TrimEnd(Path.DirectorySeparatorChar)).FullName,"owner-console-profile-data");
            Scratch=Path.Combine(data,"run-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Scratch);
            string valid=Path.Combine(Scratch,"valid");CreateProfile(valid);
            var canaryHashes=new Dictionary<string,string>();
            var canaryReceipts=new List<string>();
            foreach(string name in Names) {
                string canary=Path.Combine(valid,name,"canary.txt");
                File.WriteAllText(canary,"profile fixture canary "+name,new UTF8Encoding(false));
                canaryHashes[name]=Hash(canary);
            }
            using(var profile=ProfileIsolation.Open(valid)) {
                Need(String.Equals(profile.Root,valid,StringComparison.OrdinalIgnoreCase),"root path");
                Need(String.Equals(profile.AppData,Path.Combine(valid,"appdata"),StringComparison.OrdinalIgnoreCase),"appdata path");
                Need(String.Equals(profile.LocalAppData,Path.Combine(valid,"localappdata"),StringComparison.OrdinalIgnoreCase),"localappdata path");
                Need(String.Equals(profile.UserProfile,Path.Combine(valid,"userprofile"),StringComparison.OrdinalIgnoreCase),"userprofile path");
                Need(String.Equals(profile.Home,Path.Combine(valid,"home"),StringComparison.OrdinalIgnoreCase),"home path");
                Need(String.Equals(profile.Temp,Path.Combine(valid,"temp"),StringComparison.OrdinalIgnoreCase),"temp path");
                profile.Validate();
                RefuseMove(valid,valid+"-moved","root");
                foreach(string name in Names)RefuseMove(Path.Combine(valid,name),Path.Combine(valid,name+"-moved"),name+" child");
                RefuseMove(Scratch,Scratch+"-moved","ancestor");
                profile.Validate();
                foreach(string name in Names) {
                    string after=Hash(Path.Combine(valid,name,"canary.txt"));
                    canaryReceipts.Add(name+" before="+canaryHashes[name]+" after="+after);
                    Need(after==canaryHashes[name],name+" canary changed");
                }
            }
            File.WriteAllLines(Path.Combine(Base,"canary-hashes.txt"),canaryReceipts.ToArray());
            using(var profile=ProfileIsolation.Open(valid.ToUpperInvariant()))profile.Validate();
            Reject("relative-profile","relative path");
            Reject(@"\\server\share\profile","UNC path");
            Reject(Path.GetPathRoot(valid),"drive root");
            Reject(valid+Path.DirectorySeparatorChar,"trailing separator");
            Reject(Path.Combine(valid,"..","valid"),"dot-dot alias");
            foreach(string missing in Names) {
                string incomplete=Path.Combine(Scratch,"missing-"+missing);Directory.CreateDirectory(incomplete);
                foreach(string name in Names)if(name!=missing)Directory.CreateDirectory(Path.Combine(incomplete,name));
                Reject(incomplete,"missing "+missing);
            }
            int junctions=0;
            string rootLink=Path.Combine(Scratch,"root-link");
            if(Junction(rootLink,valid)){junctions++;Reject(rootLink,"reparse root");}
            string ancestor=Path.Combine(Scratch,"real-ancestor");string nested=Path.Combine(ancestor,"profile");CreateProfile(nested);
            string ancestorLink=Path.Combine(Scratch,"ancestor-link");
            if(Junction(ancestorLink,ancestor)){junctions++;Reject(Path.Combine(ancestorLink,"profile"),"reparse ancestor");}
            string childRoot=Path.Combine(Scratch,"child-link-root");Directory.CreateDirectory(childRoot);
            for(int i=0;i<Names.Length-1;i++)Directory.CreateDirectory(Path.Combine(childRoot,Names[i]));
            if(Junction(Path.Combine(childRoot,"temp"),Path.Combine(valid,"temp"))){junctions++;Reject(childRoot,"reparse temp child");}
            string result="PASS five canary hashes unchanged, exact paths, pin/revalidation and root/child/ancestor rename refusal, malformed and missing paths; junction rejections="+junctions+"/3";
            File.WriteAllText(Path.Combine(Base,"profile.result"),result);Console.WriteLine(result);return junctions==3?0:2;
        } catch(Exception error) {File.WriteAllText(Path.Combine(Base,"profile.failure"),error.ToString());Console.Error.WriteLine(error.Message);return 1;}
    }
}
