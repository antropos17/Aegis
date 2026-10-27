using System;
using System.Diagnostics;
using System.IO;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// Every created object is a disposable fixture under this executable's own
// task-temp directory. No existing user profile is used or modified.
internal static class ProfileFixture
{
    private static readonly string Base=AppDomain.CurrentDomain.BaseDirectory;
    private static readonly string[] Names={"appdata","localappdata","userprofile","home","temp"};
    private const string Anchor=".aegis-owner-profile-anchor";
    private static string Scratch;
    private static string[] Protected;
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool GetVolumeNameForVolumeMountPoint(string root,StringBuilder volume,uint size);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool DeviceIoControl(SafeFileHandle handle,uint code,byte[] input,uint length,IntPtr output,uint outputLength,out uint returned,IntPtr overlapped);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool CreateSymbolicLink(string link,string target,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool CreateHardLink(string link,string target,IntPtr security);
    private static void Need(bool value,string reason) {if(!value)throw new Exception(reason);}
    private static void Reject(string path,string reason)
    {
        try {using(var profile=ProfileIsolation.Open(path)){profile.Validate();}}
        catch {return;}
        throw new Exception("accepted "+reason);
    }
    private static void CreateProfile(string root)
    {
        Directory.CreateDirectory(root);foreach(string name in Names)CreateChild(root,name);
    }
    private static void CreateChild(string root,string name){string child=Path.Combine(root,name);Directory.CreateDirectory(child);File.WriteAllText(Path.Combine(child,Anchor),"owned fixture anchor "+name);}
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
    private static void RefuseAnchorChanges(string path,string reason)
    {
        string original=Hash(path),moved=path+".moved";bool renamed=false,deleted=false;
        try {File.Move(path,moved);renamed=true;}catch(IOException){}catch(UnauthorizedAccessException){}
        if(renamed)File.Move(moved,path);
        byte[] bytes=File.ReadAllBytes(path);
        try {File.Delete(path);deleted=!File.Exists(path);}catch(IOException){}catch(UnauthorizedAccessException){}
        if(deleted)File.WriteAllBytes(path,bytes);
        Need(!renamed && !deleted && Hash(path)==original,reason+" anchor changed or was removable");
    }
    private static bool Junction(string link,string target)
    {
        var start=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"cmd.exe"),"/d /c mklink /J \""+link+"\" \""+target+"\"");
        start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
        using(Process process=Process.Start(start)) {if(!process.WaitForExit(3000)){process.Kill();throw new Exception("junction command timeout");}return process.ExitCode==0;}
    }
    private static byte[] JunctionBuffer(string target)
    {
        byte[] substitute=Encoding.Unicode.GetBytes(@"\??\"+target), print=Encoding.Unicode.GetBytes(target);
        byte[] buffer=new byte[16+substitute.Length+2+print.Length+2];
        Array.Copy(BitConverter.GetBytes(0xa0000003u),0,buffer,0,4);
        Array.Copy(BitConverter.GetBytes((ushort)(buffer.Length-8)),0,buffer,4,2);
        Array.Copy(BitConverter.GetBytes((ushort)substitute.Length),0,buffer,10,2);
        Array.Copy(BitConverter.GetBytes((ushort)(substitute.Length+2)),0,buffer,12,2);
        Array.Copy(BitConverter.GetBytes((ushort)print.Length),0,buffer,14,2);
        Array.Copy(substitute,0,buffer,16,substitute.Length);Array.Copy(print,0,buffer,18+substitute.Length,print.Length);
        return buffer;
    }
    private static bool SetReparse(SafeFileHandle handle,byte[] buffer)
    {uint returned;return DeviceIoControl(handle,0x900a4,buffer,(uint)buffer.Length,IntPtr.Zero,0,out returned,IntPtr.Zero);}
    private static void ReparseControl(string root,string target,string emptyControl)
    {
        string child=Path.Combine(root,"home");byte[] data=JunctionBuffer(target);uint returned;
        using(SafeFileHandle unpinned=CreateFile(emptyControl,0x100,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            Need(!unpinned.IsInvalid && SetReparse(unpinned,data),"unpinned FSCTL_SET_REPARSE_POINT control");
            byte[] remove=new byte[8];Array.Copy(BitConverter.GetBytes(0xa0000003u),remove,4);
            Need(DeviceIoControl(unpinned,0x900ac,remove,(uint)remove.Length,IntPtr.Zero,0,out returned,IntPtr.Zero),"unprotected reparse cleanup");
        }
        using(SafeFileHandle before=CreateFile(child,0x100,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            Need(!before.IsInvalid,"pre-existing attribute-only handle");
            using(var profile=ProfileIsolation.Open(root)) {
                Need(!SetReparse(before,data) && Marshal.GetLastWin32Error()==145,"marker did not block pre-existing attribute reparse");
                using(SafeFileHandle after=CreateFile(child,0x100,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
                    Need(!after.IsInvalid,"pinned attribute-only handle");
                    Need(!SetReparse(after,data) && Marshal.GetLastWin32Error()==145,"marker did not block attribute reparse");
                }
                Need((File.GetAttributes(child)&FileAttributes.ReparsePoint)==0,"pinned child became a reparse point");profile.Validate();
            }
        }
    }
    private static int Main()
    {
        try {
            string data=Path.Combine(Directory.GetParent(Base.TrimEnd(Path.DirectorySeparatorChar)).FullName,"owner-console-profile-data");
            Scratch=Path.Combine(data,"run-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Scratch);
            string protectedDirectory=Path.Combine(Scratch,"protected");Directory.CreateDirectory(protectedDirectory);
            Protected=new[]{protectedDirectory};ProfileIsolation.ProtectedPathsForTest=delegate{return Protected;};ProfileIsolation.BeforeValidationForTest=delegate{};
            string valid=Path.Combine(Scratch,"valid");CreateProfile(valid);
            var canaryHashes=new Dictionary<string,string>();
            var canaryReceipts=new List<string>();
            foreach(string name in Names) {
                string canary=Path.Combine(valid,name,"canary.txt");
                File.WriteAllText(canary,"profile fixture canary "+name,new UTF8Encoding(false));
                File.WriteAllText(Path.Combine(valid,name,"delete-probe.txt"),"fixture");
                canaryHashes[name]=Hash(canary);
                canaryHashes["anchor-"+name]=Hash(Path.Combine(valid,name,Anchor));
            }
            using(var profile=ProfileIsolation.Open(valid)) {
                Need(String.Equals(profile.Root,valid,StringComparison.OrdinalIgnoreCase),"root path");
                Need(String.Equals(profile.AppData,Path.Combine(valid,"appdata"),StringComparison.OrdinalIgnoreCase),"appdata path");
                Need(String.Equals(profile.LocalAppData,Path.Combine(valid,"localappdata"),StringComparison.OrdinalIgnoreCase),"localappdata path");
                Need(String.Equals(profile.UserProfile,Path.Combine(valid,"userprofile"),StringComparison.OrdinalIgnoreCase),"userprofile path");
                Need(String.Equals(profile.Home,Path.Combine(valid,"home"),StringComparison.OrdinalIgnoreCase),"home path");
                Need(String.Equals(profile.Temp,Path.Combine(valid,"temp"),StringComparison.OrdinalIgnoreCase),"temp path");
                var environment=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);profile.ApplyEnvironment(environment);
                Need(environment.Count==6 && environment["APPDATA"]==profile.AppData && environment["LOCALAPPDATA"]==profile.LocalAppData &&
                    environment["USERPROFILE"]==profile.UserProfile && environment["HOME"]==profile.Home && environment["TEMP"]==profile.Temp && environment["TMP"]==profile.Temp,"profile environment");
                profile.Validate();
                using(SafeFileHandle rootWrite=CreateFile(valid,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero))Need(rootWrite.IsInvalid,"selected root writable directory handle");
                RefuseMove(valid,valid+"-moved","root");
                foreach(string name in Names)RefuseMove(Path.Combine(valid,name),Path.Combine(valid,name+"-moved"),name+" child");
                foreach(string name in Names)RefuseAnchorChanges(Path.Combine(valid,name,Anchor),name);
                RefuseMove(Scratch,Scratch+"-moved","ancestor");
                profile.Validate();
                foreach(string name in Names) {
                    string after=Hash(Path.Combine(valid,name,"canary.txt"));
                    canaryReceipts.Add(name+" before="+canaryHashes[name]+" after="+after);
                    Need(after==canaryHashes[name],name+" canary changed");
                    string anchorAfter=Hash(Path.Combine(valid,name,Anchor));
                    canaryReceipts.Add("anchor-"+name+" before="+canaryHashes["anchor-"+name]+" after="+anchorAfter);
                    Need(anchorAfter==canaryHashes["anchor-"+name],name+" anchor changed");
                }
            }
            File.WriteAllLines(Path.Combine(Base,"canary-hashes.txt"),canaryReceipts.ToArray());
            using(var profile=ProfileIsolation.Open(valid.ToUpperInvariant()))profile.Validate();
            Reject(protectedDirectory,"protected equality");
            Reject(Scratch,"protected ancestor");
            string protectedDescendant=Path.Combine(protectedDirectory,"inside");CreateProfile(protectedDescendant);
            Reject(protectedDescendant,"protected descendant");
            Protected=new[]{Path.Combine(Scratch,"protected-missing")};Reject(valid,"missing protected path");
            Protected=new[]{protectedDirectory};
            using(var changing=ProfileIsolation.Open(valid)) {
                Protected=new[]{valid};bool rejected=false;try{changing.Validate();}catch{rejected=true;}
                Need(rejected,"protected target changed without rejection");Protected=new[]{protectedDirectory};
            }
            StringBuilder volume=new StringBuilder(256);
            Need(GetVolumeNameForVolumeMountPoint(Path.GetPathRoot(valid),volume,(uint)volume.Capacity),"volume alias unavailable");
            string volumeAlias=volume.ToString()+valid.Substring(3);
            Reject(volumeAlias,"volume alias root");
            Protected=new[]{volumeAlias};Reject(valid,"protected volume alias overlap");Protected=new[]{protectedDirectory};
            Reject("relative-profile","relative path");
            Reject(@"\\server\share\profile","UNC path");
            Reject(Path.GetPathRoot(valid),"drive root");
            Reject(valid+Path.DirectorySeparatorChar,"trailing separator");
            Reject(Path.Combine(valid,"..","valid"),"dot-dot alias");
            foreach(string missing in Names) {
                string incomplete=Path.Combine(Scratch,"missing-"+missing);Directory.CreateDirectory(incomplete);
                foreach(string name in Names)if(name!=missing)CreateChild(incomplete,name);
                Reject(incomplete,"missing "+missing);
            }
            foreach(string name in Names) {
                string missingRoot=Path.Combine(Scratch,"missing-anchor-"+name);CreateProfile(missingRoot);
                File.Delete(Path.Combine(missingRoot,name,Anchor));Reject(missingRoot,"missing anchor "+name);
            }
            string badAnchor=Path.Combine(Scratch,"directory-anchor");CreateProfile(badAnchor);
            File.Delete(Path.Combine(badAnchor,"home",Anchor));Directory.CreateDirectory(Path.Combine(badAnchor,"home",Anchor));Reject(badAnchor,"directory anchor");
            string hardlinkRoot=Path.Combine(Scratch,"hardlink-anchor");CreateProfile(hardlinkRoot);
            string hardlink=Path.Combine(hardlinkRoot,"home",Anchor),hardlinkTarget=Path.Combine(Scratch,"hardlink-target");
            File.Delete(hardlink);File.WriteAllText(hardlinkTarget,"fixture hardlink target");Need(CreateHardLink(hardlink,hardlinkTarget,IntPtr.Zero),"hardlink control");Reject(hardlinkRoot,"multiple-link anchor");
            string symlinkRoot=Path.Combine(Scratch,"symlink-anchor");CreateProfile(symlinkRoot);
            string symlink=Path.Combine(symlinkRoot,"home",Anchor);File.Delete(symlink);
            bool fileLink=CreateSymbolicLink(symlink,Path.Combine(valid,"home",Anchor),2);int symlinkError=fileLink?0:Marshal.GetLastWin32Error();
            if(fileLink)Reject(symlinkRoot,"reparse file anchor");
            File.WriteAllText(Path.Combine(Base,"anchor-symlink.txt"),"fileSymlinkCreated="+fileLink+" error="+symlinkError);
            int junctions=0;
            string rootLink=Path.Combine(Scratch,"root-link");
            if(Junction(rootLink,valid)){junctions++;Reject(rootLink,"reparse root");}
            string protectedLink=Path.Combine(Scratch,"protected-link");
            Need(Junction(protectedLink,valid),"protected junction creation");
            Protected=new[]{protectedLink};Reject(valid,"protected junction target overlap");Protected=new[]{protectedDirectory};
            string movingLink=Path.Combine(Scratch,"protected-moving-link");
            Need(Junction(movingLink,protectedDirectory),"protected moving junction creation");Protected=new[]{movingLink};
            using(var profile=ProfileIsolation.Open(valid)) {
                bool removed=false;try{Directory.Delete(movingLink);removed=true;}catch(IOException){}catch(UnauthorizedAccessException){}
                if(removed) {
                    Need(Junction(movingLink,valid),"retarget junction creation");
                    bool refused=false;try{profile.Validate();}catch{refused=true;}Need(refused,"retargeted protected junction accepted");
                }
            }
            Protected=new[]{protectedDirectory};
            string ancestor=Path.Combine(Scratch,"real-ancestor");string nested=Path.Combine(ancestor,"profile");CreateProfile(nested);
            string ancestorLink=Path.Combine(Scratch,"ancestor-link");
            if(Junction(ancestorLink,ancestor)){junctions++;Reject(Path.Combine(ancestorLink,"profile"),"reparse ancestor");}
            string childRoot=Path.Combine(Scratch,"child-link-root");Directory.CreateDirectory(childRoot);
            for(int i=0;i<Names.Length-1;i++)CreateChild(childRoot,Names[i]);
            if(Junction(Path.Combine(childRoot,"temp"),Path.Combine(valid,"temp"))){junctions++;Reject(childRoot,"reparse temp child");}
            var shareResults=new List<string>();bool directoryWritesDenied=true;int contentMutationsAllowed=0;
            using(var profile=ProfileIsolation.Open(valid)) {
                foreach(string name in Names) {
                    string child=Path.Combine(valid,name),created=Path.Combine(child,"created-probe.txt"),canary=Path.Combine(child,"canary.txt"),deleted=Path.Combine(child,"delete-probe.txt");
                    bool create=false,write=false,remove=false,directoryWrite=false;
                    try{File.WriteAllText(created,"fixture");create=true;}catch(IOException){}catch(UnauthorizedAccessException){}
                    if(create)File.Delete(created);
                    try{using(FileStream stream=new FileStream(canary,FileMode.Open,FileAccess.Write,FileShare.ReadWrite|FileShare.Delete)){write=true;}}catch(IOException){}catch(UnauthorizedAccessException){}
                    try{File.Delete(deleted);remove=!File.Exists(deleted);}catch(IOException){}catch(UnauthorizedAccessException){}
                    if(remove)File.WriteAllText(deleted,"fixture");
                    using(SafeFileHandle handle=CreateFile(child,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero))directoryWrite=!handle.IsInvalid;
                    shareResults.Add(name+" create="+create+" openWrite="+write+" delete="+remove+" directoryWrite="+directoryWrite);
                    directoryWritesDenied &= !directoryWrite;
                    if(create)contentMutationsAllowed++;if(write)contentMutationsAllowed++;if(remove)contentMutationsAllowed++;
                }
            }
            File.WriteAllLines(Path.Combine(Base,"share-results.txt"),shareResults.ToArray());
            Need(directoryWritesDenied,"directory pin allowed a writable directory handle");
            Need(contentMutationsAllowed==15,"fixture content operations unexpectedly blocked");
            string writableRoot=Path.Combine(Scratch,"existing-writer");CreateProfile(writableRoot);
            using(SafeFileHandle prior=CreateFile(Path.Combine(writableRoot,"home"),0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
                Need(!prior.IsInvalid,"pre-existing writable directory handle");Reject(writableRoot,"pre-existing writable directory handle");
            }
            using(var profile=ProfileIsolation.Open(writableRoot))profile.Validate();
            string reparseRoot=Path.Combine(Scratch,"reparse-control"),reparseTarget=Path.Combine(Scratch,"reparse-target"),emptyControl=Path.Combine(Scratch,"empty-control");CreateProfile(reparseRoot);Directory.CreateDirectory(reparseTarget);Directory.CreateDirectory(emptyControl);ReparseControl(reparseRoot,reparseTarget,emptyControl);
            bool ancestorWritable,siblingCreated;
            using(var profile=ProfileIsolation.Open(valid)) {
                using(SafeFileHandle ancestorHandle=CreateFile(Scratch,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero))ancestorWritable=!ancestorHandle.IsInvalid;
                string sibling=Path.Combine(Scratch,"sibling-probe");Directory.CreateDirectory(sibling);siblingCreated=Directory.Exists(sibling);
            }
            string nonempty=Path.Combine(Scratch,"nonempty-ancestor"),nonemptyTarget=Path.Combine(Scratch,"nonempty-target");
            Directory.CreateDirectory(Path.Combine(nonempty,"keep"));Directory.CreateDirectory(nonemptyTarget);
            bool nonemptySet;int nonemptyError;
            using(SafeFileHandle handle=CreateFile(nonempty,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
                Need(!handle.IsInvalid,"non-empty ancestor writable control handle");nonemptySet=SetReparse(handle,JunctionBuffer(nonemptyTarget));nonemptyError=Marshal.GetLastWin32Error();
                if(nonemptySet){byte[] remove=new byte[8];Array.Copy(BitConverter.GetBytes(0xa0000003u),remove,4);uint returned;Need(DeviceIoControl(handle,0x900ac,remove,(uint)remove.Length,IntPtr.Zero,0,out returned,IntPtr.Zero),"restore nonempty ancestor");}
            }
            File.WriteAllText(Path.Combine(Base,"ancestor-results.txt"),"pinned writable ancestor="+ancestorWritable+"; sibling created="+siblingCreated+"; unpinned non-empty FSCTL set="+nonemptySet+"; error="+nonemptyError);
            Need(ancestorWritable && siblingCreated,"ancestor share behavior");
            string result="PASS protected paths and aliases, five anchor hashes unchanged and pinned, missing/non-file anchors refused, writable handles and FSCTL reparse refused, malformed and missing paths; junction rejections="+junctions+"/3; content operations permitted="+contentMutationsAllowed+"/15; file symlink tested="+fileLink;
            File.WriteAllText(Path.Combine(Base,"profile.result"),result);Console.WriteLine(result);return junctions==3?0:2;
        } catch(Exception error) {File.WriteAllText(Path.Combine(Base,"profile.failure"),error.ToString());Console.Error.WriteLine(error.Message);return 1;}
    }
}
