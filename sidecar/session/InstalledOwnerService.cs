using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // A retained SCM object and the exact original owner process must agree on every recheck.
    internal sealed class InstalledOwnerService : IDisposable
    {
        [StructLayout(LayoutKind.Sequential)] private struct Configuration
        { internal uint Type, Start, Error; internal IntPtr Binary, Group; internal uint Tag; internal IntPtr Dependencies, Account, Display; }
        [StructLayout(LayoutKind.Sequential)] private struct Status
        { internal uint Type, State, Accepted, Win32Exit, ServiceExit, Checkpoint, Wait, Pid, Flags; }
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenSCManager(string machine, string database, uint rights);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenService(IntPtr manager, string name, uint rights);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryServiceConfig(IntPtr service, IntPtr buffer, uint length, out uint needed);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool QueryServiceStatusEx(IntPtr service, int kind, out Status status, int length, out int needed);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool QueryServiceObjectSecurity(IntPtr service, uint information, byte[] descriptor, uint length, out uint needed);
        [DllImport("advapi32.dll")] private static extern bool CloseServiceHandle(IntPtr handle);
        private IntPtr manager, service;
        private readonly SafeFileHandle owner;
        private byte[] security;
        private bool closed;
        internal InstalledOwnerService(SafeFileHandle exactOwner)
        {
            owner = CallerNative.Duplicate(exactOwner.DangerousGetHandle());
            try
            {
                manager = OpenSCManager(null, null, 1); CallerNative.Require(manager != IntPtr.Zero);
                service = OpenService(manager, InstalledOwnerPolicy.ServiceName, 0x20005); CallerNative.Require(service != IntPtr.Zero);
                security = Security(); CheckCurrent();
            }
            catch { Dispose(); throw; }
        }
        private byte[] Security()
        {
            uint needed;
            CallerNative.Require(!QueryServiceObjectSecurity(service, 5, null, 0, out needed) && Marshal.GetLastWin32Error() == 122 && needed > 0 && needed <= 65536);
            byte[] bytes = new byte[needed]; CallerNative.Require(QueryServiceObjectSecurity(service, 5, bytes, (uint)bytes.Length, out needed) && needed == bytes.Length);
            var descriptor = new RawSecurityDescriptor(bytes, 0);
            CallerNative.Require(descriptor.Owner != null && InstalledOwnerNative.Trusted(descriptor.Owner.Value) && descriptor.DiscretionaryAcl != null);
            foreach (GenericAce entry in descriptor.DiscretionaryAcl)
            {
                CommonAce ace = entry as CommonAce; CallerNative.Require(ace != null && !ace.IsCallback && ace.SecurityIdentifier != null);
                if (ace.AceQualifier == AceQualifier.AccessDenied || (ace.AceFlags & AceFlags.InheritOnly) != 0) continue;
                CallerNative.Require(ace.AceQualifier == AceQualifier.AccessAllowed &&
                    ((unchecked((uint)ace.AccessMask) & 0x700D0172U) == 0 || InstalledOwnerNative.Trusted(ace.SecurityIdentifier.Value)));
            }
            return bytes;
        }
        internal void CheckCurrent()
        {
            CallerNative.Require(!closed && !CallerNative.HasThreadToken() && CallerNative.WaitForSingleObject(owner, 0) == 0x102);
            using (SafeFileHandle token = CallerNative.ProcessToken(owner)) CallerNative.Require(CallerIdentity.Observe(token).InstalledSystem());
            Status status; int returned;
            CallerNative.Require(QueryServiceStatusEx(service, 0, out status, Marshal.SizeOf(typeof(Status)), out returned) &&
                status.Type == 0x10 && status.State == 4 && status.Pid == CallerNative.GetProcessId(owner) && status.Pid != 0);
            uint needed;
            CallerNative.Require(!QueryServiceConfig(service, IntPtr.Zero, 0, out needed) && Marshal.GetLastWin32Error() == 122 && needed >= Marshal.SizeOf(typeof(Configuration)) && needed <= 8192);
            IntPtr buffer = Marshal.AllocHGlobal((int)needed);
            try
            {
                CallerNative.Require(QueryServiceConfig(service, buffer, needed, out needed));
                Configuration config = (Configuration)Marshal.PtrToStructure(buffer, typeof(Configuration));
                CallerNative.Require(config.Type == 0x10 && config.Start == 3 && config.Error == 1 &&
                    Marshal.PtrToStringUni(config.Binary) == "\"" + System.IO.Path.Combine(InstalledOwnerPolicy.Root, "aegis-owner.exe") + "\"" &&
                    Marshal.PtrToStringUni(config.Account) == "LocalSystem");
            }
            finally { Marshal.FreeHGlobal(buffer); }
            byte[] current = Security(); CallerNative.Require(current.Length == security.Length);
            for (int index = 0; index < current.Length; index++) CallerNative.Require(current[index] == security[index]);
        }
        public void Dispose()
        {
            if (closed) return; closed = true;
            bool failed = false;
            if (service != IntPtr.Zero && !CloseServiceHandle(service)) failed = true;
            if (manager != IntPtr.Zero && !CloseServiceHandle(manager)) failed = true;
            owner.Dispose(); if (failed) throw new InvalidOperationException("installed-service-cleanup-unconfirmed");
        }
    }
}
