using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // This original-install guard is required in addition to PermittedBroker and role admission.
    internal sealed partial class InstalledOwnerRegistration : IDisposable, ICallerInstalledEndpoint
    {
        internal readonly object JournalGate = new object();
        internal IDisposable JournalResource = null;
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
        private bool closing;
#if CALLER_MAIN_OPERATION_TEST
        // Synthetic install authority only; real enrollment, registrations and pipe admission remain required.
        private readonly Action testAuthority;
        internal bool IsTestAuthority { get { return testAuthority != null; } }
        private InstalledOwnerRegistration(InstalledOwnerPolicy policy, CallerRegistration server, IntPtr heldMain, Action checkAuthority)
        {
            CallerNative.Require(policy != null && server != null && checkAuthority != null);
            Policy = policy; owner = server; testAuthority = checkAuthority;
            try { main = CallerRegistration.RegisterMain(heldMain, server); CheckCurrent(); }
            catch { Dispose(); throw; }
        }
        internal static InstalledOwnerRegistration CreateForTest(InstalledOwnerPolicy policy, CallerRegistration server,
            IntPtr heldMain, Action checkAuthority)
        { return new InstalledOwnerRegistration(policy, server, heldMain, checkAuthority); }
#endif
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
        internal void CheckCurrent(CallerAdmissionBudget budget)
        { int substage = 0; CheckCurrent(budget, ref substage); }
        private void CheckCurrent(ref int substage)
        { CheckCurrent(null, ref substage); }
        private void CheckCurrent(CallerAdmissionBudget budget, ref int substage)
        {
            using (CallerAdmissionBudget.Enter(JournalGate, budget)) {
                CallerAdmissionBudget.Check(budget); CheckCore(ref substage, budget); CallerAdmissionBudget.Check(budget);
            }
        }
        private void CheckCore(ref int substage, CallerAdmissionBudget budget = null)
        {
            substage = 14; // Live registration and unimpersonated entry.
            CallerNative.Require(!closed && !CallerNative.HasThreadToken());
#if CALLER_MAIN_OPERATION_TEST
            if (testAuthority != null)
            {
                Policy.CheckCurrent(); owner.CheckServer(); main.CheckMain(owner); testAuthority();
                CallerNative.Require(!CallerNative.HasThreadToken()); CallerAdmissionBudget.Check(budget); return;
            }
#endif
            substage = 15; setup.CheckPolicy(Policy);
            CallerAdmissionBudget.Check(budget);
            substage = 16; service.CheckCurrent();
            CallerAdmissionBudget.Check(budget);
            substage = 17; owner.CheckCurrent();
            CallerAdmissionBudget.Check(budget);
            substage = 18; main.CheckCurrent();
            CallerAdmissionBudget.Check(budget);
            substage = 19; // Supervisor SYSTEM role.
            using (SafeFileHandle token = CallerNative.ProcessToken(self)) CallerNative.Require(CallerIdentity.Observe(token).InstalledSystem());
            CallerAdmissionBudget.Check(budget);
            substage = 20; // Main operator role.
            using (SafeFileHandle token = CallerNative.ProcessToken(setup.Main)) CallerNative.Require(CallerIdentity.Observe(token).InstalledOperator(Policy.OperatorSid));
            CallerAdmissionBudget.Check(budget);
            substage = 21; // Exact supervisor and original owner parent.
            ProcessBasic info; int returned;
            CallerNative.Require(NtQueryInformationProcess(self, 0, out info, Marshal.SizeOf(typeof(ProcessBasic)), out returned) == 0 &&
                info.Pid.ToInt64() == CallerNative.GetProcessId(self) && info.Parent.ToInt64() == CallerNative.GetProcessId(setup.Owner));
            CallerAdmissionBudget.Check(budget);
            substage = 22;
            CallerNative.Require(ownerImage.IsPinned && ownerImage.MatchesProcessImage(setup.Owner.DangerousGetHandle()));
            CallerAdmissionBudget.Check(budget);
            substage = 23;
            CallerNative.Require(mainImage.IsPinned && mainImage.MatchesProcessImage(setup.Main.DangerousGetHandle()));
            CallerAdmissionBudget.Check(budget);
            substage = 24;
            CallerNative.Require(GuestJobNative.Birth(self.DangerousGetHandle(), setup.Job.DangerousGetHandle(), CallerNative.GetProcessId(self)) == birth);
            CallerAdmissionBudget.Check(budget);
            substage = 25;
            if (inventory == null) inventory = new InstalledJobInventory(setup.Job, self, birth, ref substage);
            else inventory.CheckCurrent(ref substage);
            substage = 26; // Unimpersonated exit.
            CallerNative.Require(!CallerNative.HasThreadToken());
            CallerAdmissionBudget.Check(budget);
        }
        private void CloseResource(IDisposable value) { if (value != null) try { value.Dispose(); } catch { cleanupUnknown = true; } }
        void ICallerInstalledEndpoint.CheckCurrent() { CheckCurrent(); }
        void ICallerInstalledEndpoint.CheckCurrent(ref int substage, bool polling)
        { CheckEndpointCurrent(null, ref substage, polling); }
        void ICallerInstalledEndpoint.CheckCurrent(CallerAdmissionBudget budget, ref int substage, bool polling)
        { CallerNative.Require(budget != null); CheckEndpointCurrent(budget, ref substage, polling); }
        private void CheckEndpointCurrent(CallerAdmissionBudget budget, ref int substage, bool polling)
        {
            // Only failures translate the existing registration checkpoint. The two
            // fixed bases retain fence/poll provenance without changing authority.
            int checkpoint = 14;
            try { CheckCurrent(budget, ref checkpoint); }
            catch
            {
                if ((checkpoint >= 14 && checkpoint <= 26) || (checkpoint >= 36 && checkpoint <= 44))
                    substage = (polling ? 200 : 100) + checkpoint;
                throw;
            }
        }
        void ICallerInstalledEndpoint.CheckEndpoint(SafeFileHandle actualSelf, SafeFileHandle actualPeer)
        {
            CheckCurrent(); main.CheckHeldProcess(actualPeer);
#if CALLER_MAIN_OPERATION_TEST
            if (testAuthority != null) { owner.CheckHeldProcess(actualSelf); CheckCurrent(); return; }
#endif
            CallerNative.Require(CallerNative.GetProcessId(actualSelf) == CallerNative.GetProcessId(self) &&
                GuestJobNative.Birth(actualSelf.DangerousGetHandle(), setup.Job.DangerousGetHandle(), CallerNative.GetProcessId(actualSelf)) == birth);
            using (SafeFileHandle token = CallerNative.ProcessToken(actualSelf)) CallerNative.Require(CallerIdentity.Observe(token).InstalledSystem());
            using (SafeFileHandle token = CallerNative.ProcessToken(actualPeer)) CallerNative.Require(CallerIdentity.Observe(token).InstalledOperator(Policy.OperatorSid));
            CheckCurrent();
        }
        public void Dispose()
        {
            lock (JournalGate)
            {
                if (closing) throw new InvalidOperationException("installed-owner-registration-cleanup-unconfirmed");
                if (closed) { if (cleanupUnknown) throw new InvalidOperationException("installed-owner-registration-cleanup-unconfirmed"); return; }
                // Revoke under the acknowledgment gate, then release it before child registration locks.
                closed = true; closing = true;
            }
            try
            {
                CloseResource(JournalResource); CloseResource(mainImage); CloseResource(ownerImage); CloseResource(service);
                CloseResource(inventory); CloseResource(main);
#if CALLER_MAIN_OPERATION_TEST
                if (testAuthority == null)
#endif
                    CloseResource(owner);
                CloseResource(self); CloseResource(Policy);
            }
            finally { lock (JournalGate) closing = false; }
            lock (JournalGate) if (cleanupUnknown) throw new InvalidOperationException("installed-owner-registration-cleanup-unconfirmed");
        }
    }
}
