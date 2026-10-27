using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
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
    private sealed class Pinned { internal string Path; internal SafeFileHandle Handle; internal FileInformation Identity; }
    private readonly List<Pinned> pinned=new List<Pinned>();
    private bool disposed;
    internal string Root { get; private set; }
    internal string AppData { get { return Path.Combine(Root,"appdata"); } }
    internal string LocalAppData { get { return Path.Combine(Root,"localappdata"); } }
    internal string UserProfile { get { return Path.Combine(Root,"userprofile"); } }
    internal string Home { get { return Path.Combine(Root,"home"); } }
    internal string Temp { get { return Path.Combine(Root,"temp"); } }
    internal string Disclosure { get { return "Selected profile root: "+Escape(Root)+"\r\nAPPDATA: "+Escape(AppData)+"\r\nLOCALAPPDATA: "+Escape(LocalAppData)+"\r\nUSERPROFILE: "+Escape(UserProfile)+"\r\nHOME: "+Escape(Home)+"\r\nTEMP and TMP: "+Escape(Temp)+"\r\n"; } }

    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle,out FileInformation info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle,StringBuilder path,uint capacity,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint GetDriveType(string root);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint QueryDosDevice(string name,StringBuilder target,int capacity);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint GetWindowsDirectory(StringBuilder buffer,uint capacity);
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)] private static extern int SHGetKnownFolderPath(ref Guid id,uint flags,IntPtr token,out IntPtr path);

    internal static ProfileIsolation Open(string root)
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
            string current=volume; result.Add(current);
            foreach(string part in root.Substring(3).Split('\\')) { current=Path.Combine(current,part); result.Add(current); }
            foreach(string name in new[]{"appdata","localappdata","userprofile","home","temp"}) result.Add(Path.Combine(root,name));
            if(result.Disclosure.Length>8192) throw Failure();
            result.Validate(); return result;
        } catch { result.Dispose(); throw; }
    }

    internal void Validate()
    {
        if(disposed) throw Failure();
        foreach(Pinned item in pinned) {
            FileInformation held=Information(item.Handle);
            if(!Same(item.Identity,held) || !Canonical(item.Handle,item.Path)) throw Failure();
            using(SafeFileHandle again=OpenDirectory(item.Path)) {
                if(!Same(item.Identity,Information(again)) || !Canonical(again,item.Path)) throw Failure();
            }
        }
    }

    private void Add(string path)
    {
        SafeFileHandle handle=OpenDirectory(path);
        try {
            FileInformation info=Information(handle);
            if(!Canonical(handle,path)) throw Failure();
            pinned.Add(new Pinned { Path=path,Handle=handle,Identity=info });
        } catch { handle.Dispose(); throw; }
    }
    private static SafeFileHandle OpenDirectory(string path)
    {
        // Attribute-only handles may not participate in Windows share checks.
        // Request directory-list access so denying delete sharing is enforced.
        SafeFileHandle handle=CreateFile(path,0x81,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
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
    private static bool IsUnsafe(string root)
    {
        var windows=new StringBuilder(32768); if(GetWindowsDirectory(windows,(uint)windows.Capacity)==0) throw Failure();
        if(Overlap(root,windows.ToString()) || Overlap(root,Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)) ||
           Overlap(root,Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)) || Overlap(root,Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData)) ||
           Overlap(root,Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName))) return true;
        Guid id=new Guid("5E6C858F-0E22-4760-9AFE-EA3317B67173"); IntPtr value;
        if(SHGetKnownFolderPath(ref id,0,IntPtr.Zero,out value)!=0 || value==IntPtr.Zero) throw Failure();
        try {
            string profile=Marshal.PtrToStringUni(value), profiles=Path.GetDirectoryName(profile);
            return String.IsNullOrEmpty(profiles) || Overlap(root,profiles);
        } finally { Marshal.FreeCoTaskMem(value); }
    }
    public void Dispose() { if(disposed)return; disposed=true; foreach(Pinned item in pinned)item.Handle.Dispose(); pinned.Clear(); }
    private static InvalidOperationException Failure() { return new InvalidOperationException("profile root unavailable"); }
}
