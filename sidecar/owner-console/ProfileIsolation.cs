using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// Opt-in only. Directory handles deny delete sharing until the owned Job exits.
// This preserves selected path identity; it is not a same-user sandbox.
internal sealed class ProfileIsolation : IDisposable
{
    private const uint DirectoryAttribute=0x10, ReparseAttribute=0x400;
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
        public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME created,accessed,written;
        public uint volume,sizeHigh,sizeLow,links,indexHigh,indexLow;
    }
    private sealed class Pinned { internal string Path; internal SafeFileHandle Handle; internal FileInformation Identity; internal bool Strict; }
    private readonly List<Pinned> pinned=new List<Pinned>();
    private readonly List<Pinned> markers=new List<Pinned>();
    internal const string MarkerName=".aegis-owner-profile-anchor";
    private bool disposed;
#if OWNER_PROFILE_TEST
    internal static Func<string[]> ProtectedPathsForTest;
    internal static Action BeforeValidationForTest;
    internal static Func<long> DeadlineClockForTest=null;
    internal static Action BeforeDeadlineWatchdogForTest=null;
    internal static Func<bool> DeadlineTerminateForTest=null;
    internal static Action AfterProfileOpenForTest=null;
    internal static IDisposable NewDeadlineForTest() { return new Deadline(); }
#endif
    internal string Root { get; private set; }
    internal string AppData { get { return Path.Combine(Root,"appdata"); } }
    internal string LocalAppData { get { return Path.Combine(Root,"localappdata"); } }
    internal string UserProfile { get { return Path.Combine(Root,"userprofile"); } }
    internal string Home { get { return Path.Combine(Root,"home"); } }
    internal string Temp { get { return Path.Combine(Root,"temp"); } }
    internal string Disclosure { get { return "Selected profile root: "+Escape(Root)+"\r\nAPPDATA: "+Escape(AppData)+"\r\nLOCALAPPDATA: "+Escape(LocalAppData)+"\r\nUSERPROFILE: "+Escape(UserProfile)+"\r\nHOME: "+Escape(Home)+"\r\nTEMP and TMP: "+Escape(Temp)+"\r\n"; } }
    internal void ApplyEnvironment(IDictionary<string,string> environment)
    {
        if(disposed || environment==null)throw Failure();
        environment["APPDATA"]=AppData; environment["LOCALAPPDATA"]=LocalAppData;
        environment["USERPROFILE"]=UserProfile; environment["HOME"]=Home;
        environment["TEMP"]=Temp; environment["TMP"]=Temp;
    }

    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle,out FileInformation info);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint GetFileType(SafeFileHandle handle);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle,StringBuilder path,uint capacity,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint GetDriveType(string root);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint QueryDosDevice(string name,StringBuilder target,int capacity);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint GetWindowsDirectory(StringBuilder buffer,uint capacity);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,StringBuilder volumeName,uint volumeLength,out uint serial,out uint maxComponent,out uint flags,StringBuilder filesystem,uint filesystemLength);
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)] private static extern int SHGetKnownFolderPath(ref Guid id,uint flags,IntPtr token,out IntPtr path);
    [DllImport("advapi32.dll",SetLastError=true)] private static extern uint GetSecurityInfo(SafeFileHandle handle,int objectType,uint information,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool TerminateProcess(IntPtr process,uint exitCode);

    // A filesystem filter may stall synchronous directory metadata calls. If
    // they exceed the bound, terminate the owner; Job close requests cleanup,
    // but this abnormal exit deliberately does not claim a cleanup receipt.
    private sealed class Deadline : IDisposable
    {
        private readonly ManualResetEvent completed=new ManualResetEvent(false);
        private readonly Thread watchdog;
        private readonly long started;
        private int state;
        internal Deadline() {
            started=Timestamp();
            watchdog=new Thread(delegate() {
#if OWNER_PROFILE_TEST
                if(BeforeDeadlineWatchdogForTest!=null) BeforeDeadlineWatchdogForTest();
#endif
                while(true) {
                    long elapsed=Timestamp()-started;
                    if(elapsed<0 || elapsed>=Stopwatch.Frequency*3) {
                        if(Interlocked.CompareExchange(ref state,1,0)==0) Terminate();
                        return;
                    }
                    long remaining=Stopwatch.Frequency*3-elapsed;
                    int wait=(int)Math.Max(1,Math.Ceiling((double)remaining*1000/Stopwatch.Frequency));
                    if(completed.WaitOne(wait)) return;
                }
            });
            watchdog.IsBackground=true; watchdog.Start();
        }
        public void Dispose() {
            long elapsed=Timestamp()-started;
            bool expired=elapsed<0 || elapsed>=Stopwatch.Frequency*3;
            int prior=Interlocked.CompareExchange(ref state,expired?1:2,0);
            completed.Set();
            if(!watchdog.Join(1000)) { Terminate(); throw Failure(); }
            completed.Dispose();
            long finished=Timestamp()-started;
            if(expired || prior!=0 || finished<0 || finished>=Stopwatch.Frequency*3) { Terminate(); throw Failure(); }
        }
        private static long Timestamp() {
#if OWNER_PROFILE_TEST
            if(DeadlineClockForTest!=null) return DeadlineClockForTest();
#endif
            return Stopwatch.GetTimestamp();
        }
        private static void Terminate() {
#if OWNER_PROFILE_TEST
            if(DeadlineTerminateForTest!=null) { DeadlineTerminateForTest(); return; }
#endif
            TerminateProcess(GetCurrentProcess(),2);
        }
    }

    internal static ProfileIsolation Open(string root)
    {
        ProfileIsolation result=null;
        try {
            using(new Deadline()) {
                result=OpenCore(root);
#if OWNER_PROFILE_TEST
                if(AfterProfileOpenForTest!=null) AfterProfileOpenForTest();
#endif
            }
            return result;
        }
        catch { if(result!=null) result.Dispose(); throw; }
    }
    private static ProfileIsolation OpenCore(string root)
    {
        if(String.IsNullOrEmpty(root) || root.Length<4 || root.Length>1024 || root.IndexOf('/')>=0 ||
           !((root[0]>='A' && root[0]<='Z') || (root[0]>='a' && root[0]<='z')) || root[1]!=':' || root[2]!='\\' || root.EndsWith("\\",StringComparison.Ordinal) ||
           !String.Equals(root,Path.GetFullPath(root),StringComparison.OrdinalIgnoreCase)) throw Failure();
        string volume=root.Substring(0,3);
        if(GetDriveType(volume)!=3) throw Failure();
        var device=new StringBuilder(32768);
        if(QueryDosDevice(root.Substring(0,2),device,device.Capacity)==0 || !device.ToString().StartsWith(@"\Device\HarddiskVolume",StringComparison.OrdinalIgnoreCase)) throw Failure();
        foreach(string part in root.Substring(3).Split('\\'))
            if(part.Length==0 || part.EndsWith(".",StringComparison.Ordinal) || part.EndsWith(" ",StringComparison.Ordinal) || part.IndexOf(':')>=0) throw Failure();
        if(IsUnsafe(root)) throw Failure();
        var result=new ProfileIsolation(); result.Root=root;
        try {
            string current=volume; result.Add(current,false); result.RequireNtfs();
            string[] parts=root.Substring(3).Split('\\');
            for(int i=0;i<parts.Length;i++) { current=Path.Combine(current,parts[i]); result.Add(current,i==parts.Length-1); }
            foreach(string name in new[]{"appdata","localappdata","userprofile","home","temp"}) {
                string child=Path.Combine(root,name); result.Add(child,true); result.AddMarker(Path.Combine(child,MarkerName));
            }
            if(result.Disclosure.Length>8192) throw Failure();
            result.ValidateCore(); return result;
        } catch { result.Dispose(); throw; }
    }

    internal void Validate()
    {
        using(new Deadline()) {
#if OWNER_PROFILE_TEST
            if(BeforeValidationForTest!=null) BeforeValidationForTest();
#endif
            ValidateCore();
        }
    }
    private void ValidateCore()
    {
        if(disposed) throw Failure();
        if(IsUnsafe(Root)) throw Failure();
        RequireNtfs();
        for(int i=0;i<pinned.Count;i++) {
            Pinned item=pinned[i];
            // Every ancestor retains the next path component, preventing it
            // becoming empty while its no-delete-sharing handle is held.
            if(i>0) {
                string expectedParent=item.Strict && i>0 && String.Equals(Path.GetDirectoryName(item.Path),Root,StringComparison.OrdinalIgnoreCase) ? Root : pinned[i-1].Path;
                if(!String.Equals(Path.GetDirectoryName(item.Path).TrimEnd('\\'),expectedParent.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase)) throw Failure();
            }
            FileInformation held=Information(item.Handle);
            if(!Same(item.Identity,held) || held.volume!=pinned[0].Identity.volume || !Canonical(item.Handle,item.Path)) throw Failure();
            using(SafeFileHandle again=OpenDirectory(item.Path,item.Strict)) {
                if(!Same(item.Identity,Information(again)) || !Canonical(again,item.Path)) throw Failure();
            }
        }
        foreach(Pinned item in markers) {
            FileInformation held=MarkerInformation(item.Handle);
            if(!Same(item.Identity,held) || held.volume!=pinned[0].Identity.volume || !Canonical(item.Handle,item.Path))throw Failure();
            using(SafeFileHandle again=OpenMarker(item.Path)) {
                if(!Same(item.Identity,MarkerInformation(again)) || !Canonical(again,item.Path))throw Failure();
            }
        }
    }

    private void RequireNtfs()
    {
        uint serial,maxComponent,flags; var filesystem=new StringBuilder(128);
        if(pinned.Count==0 || !GetVolumeInformationByHandleW(pinned[0].Handle,null,0,out serial,out maxComponent,out flags,filesystem,(uint)filesystem.Capacity) ||
           !String.Equals(filesystem.ToString(),"NTFS",StringComparison.OrdinalIgnoreCase)) throw Failure();
    }
    private void Add(string path,bool strict)
    {
        SafeFileHandle handle=OpenDirectory(path,strict);
        try {
            FileInformation info=Information(handle);
            if(!Canonical(handle,path)) throw Failure();
            pinned.Add(new Pinned { Path=path,Handle=handle,Identity=info,Strict=strict });
        } catch { handle.Dispose(); throw; }
    }
    private void AddMarker(string path)
    {
        SafeFileHandle handle=OpenMarker(path);
        try {
            FileInformation info=MarkerInformation(handle);
            if(!Canonical(handle,path))throw Failure();
            markers.Add(new Pinned { Path=path,Handle=handle,Identity=info,Strict=true });
        } catch { handle.Dispose(); throw; }
    }
    private static SafeFileHandle OpenMarker(string path)
    {
        SafeFileHandle handle=CreateFile(path,0x20081,3,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
        if(handle.IsInvalid) { handle.Dispose(); throw Failure(); }
        return handle;
    }
    private static FileInformation MarkerInformation(SafeFileHandle handle)
    {
        FileInformation info;
        if(!GetFileInformationByHandle(handle,out info) || GetFileType(handle)!=1 || (info.attributes&(DirectoryAttribute|ReparseAttribute|0x40))!=0 || info.links!=1)throw Failure();
        IntPtr owner,group,dacl,sacl,descriptor;
        if(GetSecurityInfo(handle,1,1,out owner,out group,out dacl,out sacl,out descriptor)!=0 || descriptor==IntPtr.Zero)throw Failure();
        try {
            if(owner==IntPtr.Zero)throw Failure();
            using(WindowsIdentity identity=WindowsIdentity.GetCurrent()) {
                if(identity.User==null || !identity.User.Equals(new SecurityIdentifier(owner)))throw Failure();
            }
        } finally { LocalFree(descriptor); }
        return info;
    }
    private static SafeFileHandle OpenDirectory(string path,bool strict)
    {
        // Attribute-only handles may not participate in Windows share checks.
        // Request directory-list access so denying delete sharing is enforced.
        SafeFileHandle handle=CreateFile(path,0x81,strict?1u:3u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
        if(handle.IsInvalid) { handle.Dispose(); throw Failure(); }
        return handle;
    }
    private static FileInformation Information(SafeFileHandle handle)
    {
        FileInformation info;
        if(!GetFileInformationByHandle(handle,out info) || (info.attributes&DirectoryAttribute)==0 || (info.attributes&ReparseAttribute)!=0) throw Failure();
        return info;
    }
    private static bool Same(FileInformation left,FileInformation right)
    { return left.volume==right.volume && left.indexHigh==right.indexHigh && left.indexLow==right.indexLow; }
    private static bool Canonical(SafeFileHandle handle,string expected)
    {
        var path=new StringBuilder(32768); uint count=GetFinalPathNameByHandle(handle,path,(uint)path.Capacity,0);
        if(count==0 || count>=path.Capacity) return false;
        string actual=path.ToString();
        if(!actual.StartsWith(@"\\?\",StringComparison.Ordinal)) return false;
        return String.Equals(actual.Substring(4).TrimEnd('\\'),expected.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase);
    }
    private static bool Overlap(string left,string right)
    {
        if(String.IsNullOrEmpty(right)) return false;
        string a=left.TrimEnd('\\'), b=Path.GetFullPath(right).TrimEnd('\\');
        return a.Equals(b,StringComparison.OrdinalIgnoreCase) || a.StartsWith(b+"\\",StringComparison.OrdinalIgnoreCase) || b.StartsWith(a+"\\",StringComparison.OrdinalIgnoreCase);
    }
    private static bool CanonicalOverlap(string left,string right)
    {
        string a=left.TrimEnd('\\'), b=right.TrimEnd('\\');
        return a.Equals(b,StringComparison.OrdinalIgnoreCase) || a.StartsWith(b+"\\",StringComparison.OrdinalIgnoreCase) || b.StartsWith(a+"\\",StringComparison.OrdinalIgnoreCase);
    }
    private static string Escape(string value)
    {
        var text=new StringBuilder();
        foreach(char c in value) {
            if(c=='\\')text.Append("\\\\");
            else if(c=='\"')text.Append("\\\"");
            else if(c<0x20 || c>0x7e)text.Append("\\u").Append(((int)c).ToString("x4"));
            else text.Append(c);
        }
        return text.ToString();
    }
    private static string Known(string id)
    {
        Guid guid=new Guid(id); IntPtr value;
        if(SHGetKnownFolderPath(ref guid,0,IntPtr.Zero,out value)!=0 || value==IntPtr.Zero) throw Failure();
        try { string result=Marshal.PtrToStringUni(value); if(String.IsNullOrEmpty(result))throw Failure(); return result; }
        finally { Marshal.FreeCoTaskMem(value); }
    }
    private static string[] ProtectedPaths()
    {
#if OWNER_PROFILE_TEST
        if(ProtectedPathsForTest!=null) return ProtectedPathsForTest();
#endif
        var windows=new StringBuilder(32768); if(GetWindowsDirectory(windows,(uint)windows.Capacity)==0) throw Failure();
        string profile=Known("5E6C858F-0E22-4760-9AFE-EA3317B67173");
        string parent=Path.GetDirectoryName(profile); if(String.IsNullOrEmpty(parent))throw Failure();
        return new[]{profile,parent,Known("3EB685DB-65F9-4CF6-A03A-E3EF65729F3D"),Known("F1B32785-6FBA-4FCF-9D55-7B8E7F157091"),windows.ToString(),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName)};
    }
    private static string FinalVolumePath(SafeFileHandle handle)
    {
        var result=new StringBuilder(32768); uint length=GetFinalPathNameByHandle(handle,result,(uint)result.Capacity,1);
        if(length==0 || length>=result.Capacity)throw Failure();
        string path=result.ToString();
        if(!path.StartsWith(@"\\?\Volume{",StringComparison.OrdinalIgnoreCase))throw Failure();
        return path;
    }
    private static bool IsUnsafe(string root)
    {
        string[] paths=ProtectedPaths(); if(paths==null || paths.Length==0)throw Failure();
        foreach(string protectedPath in paths) { if(String.IsNullOrEmpty(protectedPath))throw Failure(); if(Overlap(root,protectedPath))return true; }
        using(SafeFileHandle selected=OpenDirectory(root,true)) {
            string rootPath=FinalVolumePath(selected);
            foreach(string protectedPath in paths) {
                using(SafeFileHandle target=CreateFile(protectedPath,0x80,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
                    if(target.IsInvalid)throw Failure();
                    FileInformation info; if(!GetFileInformationByHandle(target,out info) || (info.attributes&DirectoryAttribute)==0)throw Failure();
                    if(CanonicalOverlap(rootPath,FinalVolumePath(target)))return true;
                }
            }
        }
        return false;
    }
    public void Dispose() {
        if(disposed)return;
        using(new Deadline()) { disposed=true; foreach(Pinned item in markers)item.Handle.Dispose(); markers.Clear(); foreach(Pinned item in pinned)item.Handle.Dispose(); pinned.Clear(); }
    }
    private static InvalidOperationException Failure() { return new InvalidOperationException("profile root unavailable"); }
}
