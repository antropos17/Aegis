using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // This original-install guard is required in addition to PermittedBroker and role admission.
    internal sealed class InstalledOwnerRegistration : IDisposable, ICallerInstalledEndpoint
    {
        [StructLayout(LayoutKind.Sequential)] private struct ProcessBasic
        { internal IntPtr Exit, Peb, Affinity, Priority, Pid, Parent; }
        [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(SafeFileHandle process, int kind,
            out ProcessBasic value, int length, out int returned);
        private readonly InstalledOwnerBootstrap setup;
        internal readonly InstalledOwnerPolicy Policy;
        private InstalledOwnerService service;
        private CallerRegistration owner, main;
        private AppContainerExecutable.PinnedFile ownerImage, mainImage;
        private SafeFileHandle self;
        private InstalledJobInventory inventory;
        private long birth;
        private bool closed, cleanupUnknown;
        internal InstalledOwnerRegistration(InstalledOwnerBootstrap original, ref int substage)
        {
            substage = 1; setup = original; Policy = InstalledOwnerPolicy.Acquire();
            try
            {
                substage = 2; // Bind the acquired policy to the original bootstrap.
                setup.CheckPolicy(Policy);
                substage = 3;
                using (var current = Process.GetCurrentProcess())
                { substage = 4; self = CallerNative.Duplicate(current.Handle); }
                substage = 5; // Observe self birth through the original owned Job.
                birth = GuestJobNative.Birth(self.DangerousGetHandle(), setup.Job.DangerousGetHandle(), CallerNative.GetProcessId(self));
                substage = 6;
                owner = new CallerRegistration(setup.Owner.DangerousGetHandle(), setup.Session);
                substage = 7;
                main = new CallerRegistration(setup.Main.DangerousGetHandle(), setup.Session);
                substage = 8;
                service = new InstalledOwnerService(setup.Owner);
                substage = 9;
                ownerImage = AppContainerExecutable.Open(System.IO.Path.Combine(InstalledOwnerPolicy.Root, "aegis-owner.exe"), Policy.OwnerSize, Policy.OwnerHash);
                substage = 10;
                mainImage = AppContainerExecutable.Open(System.IO.Path.Combine(InstalledOwnerPolicy.Root, "aegis-main.exe"), Policy.MainSize, Policy.MainHash);
                substage = 11; // Enter the constructor authority recheck.
                CheckCurrent(ref substage);
            }
            catch { Dispose(); throw; }
        }
        internal void CheckCurrent()
        {
            // Later calls retain their outer stage and substage zero on failure.
            int substage = 0; CheckCurrent(ref substage);
        }
        private void CheckCurrent(ref int substage)
        {
            substage = 14; // Live registration and unimpersonated entry.
            CallerNative.Require(!closed && !CallerNative.HasThreadToken());
            substage = 15; setup.CheckPolicy(Policy);
            substage = 16; service.CheckCurrent();
            substage = 17; owner.CheckCurrent();
            substage = 18; main.CheckCurrent();
            substage = 19; // Supervisor SYSTEM role.
            using (SafeFileHandle token = CallerNative.ProcessToken(self)) CallerNative.Require(CallerIdentity.Observe(token).InstalledSystem());
            substage = 20; // Main operator role.
            using (SafeFileHandle token = CallerNative.ProcessToken(setup.Main)) CallerNative.Require(CallerIdentity.Observe(token).InstalledOperator(Policy.OperatorSid));
            substage = 21; // Exact supervisor and original owner parent.
            ProcessBasic info; int returned;
            CallerNative.Require(NtQueryInformationProcess(self, 0, out info, Marshal.SizeOf(typeof(ProcessBasic)), out returned) == 0 &&
                info.Pid.ToInt64() == CallerNative.GetProcessId(self) && info.Parent.ToInt64() == CallerNative.GetProcessId(setup.Owner));
            substage = 22;
            CallerNative.Require(ownerImage.IsPinned && ownerImage.MatchesProcessImage(setup.Owner.DangerousGetHandle()));
            substage = 23;
            CallerNative.Require(mainImage.IsPinned && mainImage.MatchesProcessImage(setup.Main.DangerousGetHandle()));
            substage = 24;
            CallerNative.Require(GuestJobNative.Birth(self.DangerousGetHandle(), setup.Job.DangerousGetHandle(), CallerNative.GetProcessId(self)) == birth);
            substage = 25;
            if (inventory == null) inventory = new InstalledJobInventory(setup.Job, self, birth, ref substage);
            else inventory.CheckCurrent(ref substage);
            substage = 26; // Unimpersonated exit.
            CallerNative.Require(!CallerNative.HasThreadToken());
        }
        private void CloseResource(IDisposable value) { if (value != null) try { value.Dispose(); } catch { cleanupUnknown = true; } }
        void ICallerInstalledEndpoint.CheckCurrent() { CheckCurrent(); }
        void ICallerInstalledEndpoint.CheckEndpoint(SafeFileHandle actualSelf, SafeFileHandle actualPeer)
        {
            CheckCurrent(); main.CheckHeldProcess(actualPeer);
            CallerNative.Require(CallerNative.GetProcessId(actualSelf) == CallerNative.GetProcessId(self) &&
                GuestJobNative.Birth(actualSelf.DangerousGetHandle(), setup.Job.DangerousGetHandle(), CallerNative.GetProcessId(actualSelf)) == birth);
            using (SafeFileHandle token = CallerNative.ProcessToken(actualSelf)) CallerNative.Require(CallerIdentity.Observe(token).InstalledSystem());
            using (SafeFileHandle token = CallerNative.ProcessToken(actualPeer)) CallerNative.Require(CallerIdentity.Observe(token).InstalledOperator(Policy.OperatorSid));
            CheckCurrent();
        }
        public void Dispose()
        {
            if (!closed)
            {
                closed = true; CloseResource(mainImage); CloseResource(ownerImage); CloseResource(service);
                CloseResource(inventory); CloseResource(main); CloseResource(owner); CloseResource(self); CloseResource(Policy);
            }
            if (cleanupUnknown) throw new InvalidOperationException("installed-owner-registration-cleanup-unconfirmed");
        }
    }
}
