using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

namespace Aegis.InstalledOwner
{
    internal sealed class InstalledOwnerRuntime : IDisposable
    {
        private readonly object gate = new object();
        private CallerLauncherNative.Created supervisor, main;
        private InstalledOwnerPipe supervisorInput, supervisorOutput, mainInput;
        private AppContainerExecutable.PinnedFile supervisorImage, mainImage, ownerImage;
        private InstalledOwnerPolicy policy;
        private InstalledOwnerService service;
        private SafeFileHandle self, token, supervisorToken, mainToken;
        private Timer timer;
        private bool closed, cleanupUnknown;
        private string inspection;
        private CallerIdentity actual;
        private CallerIdentity selectedOperator;
        private CallerIdentity protectedIdentity;
        private uint supervisorPid, mainPid;
        private long ownerBirth, supervisorBirth, mainBirth;
        private string phase = "acquire-owner";
        private uint supervisorStage, supervisorSubstage;
        private bool producerReady, bootstrapWritten, bootstrapEof, supervisorReleased, mainReleased;
        private uint supervisorExitCode = 259;

        internal bool Run(InstalledOwnerDeadline deadline = null)
        {
            deadline = deadline ?? new InstalledOwnerDeadline(12000);
            try
            {
                lock (gate)
                {
                    CallerNative.Require(!closed && !CallerNative.HasThreadToken());
                    self = CallerNative.DuplicateSelf();
                    using (SafeFileHandle currentToken = CallerNative.ProcessToken(self)) protectedIdentity = CallerIdentity.Observe(currentToken);
                    CallerNative.Require(protectedIdentity.InstalledSystem()); ownerBirth = Birth(self);
                    service = new InstalledOwnerService(self); policy = InstalledOwnerPolicy.Acquire();
                    InstalledOwnerFiles.RequireFreshReceipts(policy);
                    ownerImage = AppContainerExecutable.Open(Path.Combine(InstalledOwnerPolicy.Root, "aegis-owner.exe"), policy.OwnerSize, policy.OwnerHash);
                    CallerNative.Require(ownerImage.IsPinned && ownerImage.MatchesProcessImage(self.DangerousGetHandle()));
                    phase = "operator-token";
                    token = InstalledOwnerNative.OperatorToken(policy); selectedOperator = CallerIdentity.Observe(token);
                    supervisorToken = InstalledOwnerNative.SupervisorToken(policy.OperatorSid);
                    supervisorImage = AppContainerExecutable.Open(Path.Combine(InstalledOwnerPolicy.Root, "aegis-session.exe"), policy.SupervisorSize, policy.SupervisorHash);
                    mainImage = AppContainerExecutable.Open(Path.Combine(InstalledOwnerPolicy.Root, "aegis-main.exe"), policy.MainSize, policy.MainHash);
                    supervisorInput = new InstalledOwnerPipe(false); supervisorOutput = new InstalledOwnerPipe(true); mainInput = new InstalledOwnerPipe(false);
                    var launcher = new CallerLauncherNative();
                    phase = "create-children";
                    supervisor = launcher.CreateInstalled(Path.Combine(InstalledOwnerPolicy.Root, "aegis-session.exe"), supervisorToken, supervisorInput.Read, supervisorOutput.Write, false);
                    main = launcher.CreateInstalled(Path.Combine(InstalledOwnerPolicy.Root, "aegis-main.exe"), token, mainInput.Read, null, true);
                    // Assignment may duplicate the token object. Pin the actual suspended child's token,
                    // requiring the approved logon tuple/profile before detecting later replacement.
                    mainToken = CallerNative.ProcessToken(main.Process); actual = CallerIdentity.Observe(mainToken);
                    CallerNative.Require(selectedOperator.SameOperator(actual) && actual.InstalledOperator(policy.OperatorSid));
                    supervisorPid = supervisor.Pid; mainPid = main.Pid;
                    supervisorBirth = Birth(supervisor.Process); mainBirth = Birth(main.Process);
                    supervisorInput.Read.Dispose(); supervisorOutput.Write.Dispose(); mainInput.Read.Dispose();
                    CheckChildren(); deadline.Check();
                    phase = "publish-main"; InstalledOwnerFiles.PublishMain(policy, actual);
                    string oldDigest = policy.Digest; policy.Dispose(); policy = InstalledOwnerPolicy.Acquire();
                    CallerNative.Require(policy.Digest == oldDigest); CheckChildren(); producerReady = true;
                    string session = Guid.NewGuid().ToString("N");
                    phase = "supply-supervisor"; InstalledOwnerPipe.Send(supervisorInput.Write, InstalledOwnerBootstrap.Issue(self, supervisor, main, policy, session), deadline);
                    bootstrapWritten = true; supervisorInput.Write.Dispose(); bootstrapEof = true;
                    timer = new Timer(Expire, null, deadline.Remaining, Timeout.Infinite);
                    deadline.Check(); CallerNative.Require(CallerLauncherNative.ResumeThread(supervisor.Thread) == 1); supervisorReleased = true;
                }
                phase = "await-completion";
                string completion = Encoding.ASCII.GetString(InstalledOwnerPipe.ReadExact(supervisorOutput.Read, 104, deadline));
                uint failureStage, failureSubstage;
                if (InstalledOwnerSession.TryReadFailureFrame(completion, out failureStage, out failureSubstage))
                { supervisorStage = failureStage; supervisorSubstage = failureSubstage; CallerNative.Require(false); }
                CallerNative.Require(Regex.IsMatch(completion, "\\AAEGISC02[a-f0-9]{96}\\z"));
                lock (gate)
                {
                    CheckChildren();
                    phase = "supply-main";
                    IntPtr server = InstalledOwnerPipe.Reduce(supervisor.Process, main.Process, 0x00101000);
                    long birth, exit, kernel, user;
                    CallerNative.Require(CallerNative.GetProcessTimes(supervisor.Process, out birth, out exit, out kernel, out user));
                    string bootstrap = "AEGISB01" + server.ToInt64().ToString("x16") + supervisor.Pid.ToString("x8") + birth.ToString("x16") + completion.Substring(8);
                    string frame = "AEGISM02" + bootstrap + policy.SelectionId + policy.SelectionEpoch + policy.Revision.ToString("x8");
                    InstalledOwnerPipe.Send(mainInput.Write, Encoding.ASCII.GetBytes(frame), deadline); mainInput.Write.Dispose();
                    CheckChildren(); deadline.Check(); CallerNative.Require(CallerLauncherNative.ResumeThread(main.Thread) == 1); mainReleased = true;
                }
                phase = "await-result";
                string header = Encoding.ASCII.GetString(InstalledOwnerPipe.ReadExact(supervisorOutput.Read, 16, deadline));
                if (Regex.IsMatch(header, "\\AAEGISF02[a-f0-9]{8}\\z"))
                {
                    string suffix = Encoding.ASCII.GetString(InstalledOwnerPipe.ReadExact(supervisorOutput.Read, 88, deadline));
                    CallerNative.Require(InstalledOwnerSession.TryReadFailureFrame(header + suffix, out failureStage, out failureSubstage));
                    supervisorStage = failureStage; supervisorSubstage = failureSubstage; CallerNative.Require(false);
                }
                CallerNative.Require(Regex.IsMatch(header, "\\AAEGISR02[a-f0-9]{8}\\z")); int size = Convert.ToInt32(header.Substring(8), 16);
                CallerNative.Require(size > 0 && size <= 1024);
                string result = new UTF8Encoding(false, true).GetString(InstalledOwnerPipe.ReadExact(supervisorOutput.Read, size, deadline));
                InstalledOwnerPipe.Eof(supervisorOutput.Read, deadline);
                lock (gate)
                {
                    phase = "confirm-result"; CallerNative.Require(!closed); service.CheckCurrent(); policy.CheckCurrent();
                    // The exact original supervisor produced completion/result; it must exit successfully before acceptance.
                    CallerNative.Require(CallerNative.WaitForSingleObject(supervisor.Process, (uint)Math.Min(2000, deadline.Remaining)) == 0);
                    uint code; CallerNative.Require(GetExitCodeProcess(supervisor.Process, out code) && code == 0);
                    string expected = "{\"schemaVersion\":1,\"scope\":\"retained-inventory-inspection\",\"selectionId\":\"" + policy.SelectionId +
                        "\",\"revision\":" + policy.Revision + ",\"epoch\":\"" + policy.SelectionEpoch + "\",\"inventoryObserved\":true,\"ownershipQualified\":false,\"launchAllowed\":false}";
                    CallerNative.Require(result == expected); deadline.Check(); inspection = result; phase = "complete";
                }
            }
            catch { /* Fixed receipt fields only; native exceptions never become output. */ }
            finally { Dispose(); }
            if (policy == null) return false;
            int observedCount = InstalledOwnerFiles.InspectionCount(policy);
            bool success = inspection != null && observedCount == 1 && !cleanupUnknown;
            string receipt = "{\"schemaVersion\":1,\"scope\":\"installed-owner-inspection\",\"inspected\":" + (success ? "true" : "false") +
                ",\"phase\":\"" + phase + "\",\"supervisorStage\":" + supervisorStage +
                ",\"supervisorSubstage\":" + supervisorSubstage +
                ",\"nativeProducerReady\":" + (producerReady ? "true" : "false") + ",\"bootstrapWriteCompleted\":" + (bootstrapWritten ? "true" : "false") +
                ",\"bootstrapEofClosed\":" + (bootstrapEof ? "true" : "false") + ",\"supervisorReleased\":" + (supervisorReleased ? "true" : "false") +
                ",\"mainReleased\":" + (mainReleased ? "true" : "false") + ",\"supervisorExitCode\":" + supervisorExitCode +
                ",\"inspectionCount\":" + observedCount + ",\"cleanupConfirmed\":" + (!cleanupUnknown ? "true" : "false") +
                ",\"supervisorPid\":" + supervisorPid + ",\"mainPid\":" + mainPid + ",\"operatorSid\":\"" + (actual == null ? "" : actual.OperatorSid) +
                "\",\"operatorAuthentication\":\"" + (actual == null ? "" : actual.OperatorAuthentication) + "\",\"operatorSession\":0," +
                "\"ownerService\":\"" + InstalledOwnerPolicy.ServiceName + "\",\"ownerSid\":\"" + (protectedIdentity == null ? "" : protectedIdentity.OperatorSid) +
                "\",\"ownerAuthentication\":\"" + (protectedIdentity == null ? "" : protectedIdentity.OperatorAuthentication) + "\",\"ownerSession\":0," +
                "\"ownerBirth\":\"" + ownerBirth.ToString("x16") + "\",\"supervisorBirth\":\"" + supervisorBirth.ToString("x16") + "\",\"mainBirth\":\"" + mainBirth.ToString("x16") +
                "\",\"installId\":\"" + policy.InstallId + "\",\"revision\":" + policy.Revision + ",\"epoch\":\"" + policy.Epoch +
                "\",\"ownerImageSha256\":\"" + policy.OwnerHash + "\",\"supervisorImageSha256\":\"" + policy.SupervisorHash + "\",\"mainImageSha256\":\"" + policy.MainHash +
                "\",\"ownedJobsEmpty\":" + (!cleanupUnknown ? "true" : "false") + ",\"launchAllowed\":false,\"completeE1\":false,\"inspection\":" + (inspection ?? "null") + "}";
            InstalledOwnerFiles.WriteNew(true, "owner-result.json", receipt, policy); return success;
        }
        [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);
        private static long Birth(SafeFileHandle process)
        { long birth, exit, kernel, user; CallerNative.Require(CallerNative.GetProcessTimes(process, out birth, out exit, out kernel, out user) && birth > 0); return birth; }
        private void CheckChildren()
        {
            CallerNative.Require(!closed && !CallerNative.HasThreadToken()); service.CheckCurrent(); policy.CheckCurrent();
            CallerLauncherNative.CheckCreated(supervisor); CallerLauncherNative.CheckCreated(main);
            CallerNative.Require(ownerImage.IsPinned && ownerImage.MatchesProcessImage(self.DangerousGetHandle()) && supervisorImage.IsPinned &&
                supervisorImage.MatchesProcessImage(supervisor.Process.DangerousGetHandle()) && mainImage.IsPinned && mainImage.MatchesProcessImage(main.Process.DangerousGetHandle()));
            using (var current = CallerNative.ProcessToken(main.Process)) CallerNative.Require(actual.SamePrimaryToken(CallerIdentity.Observe(current)));
            CallerNative.Require(selectedOperator.SamePrimaryToken(CallerIdentity.Observe(token)) && actual.SamePrimaryToken(CallerIdentity.Observe(mainToken)));
            using (var current = CallerNative.ProcessToken(supervisor.Process)) CallerNative.Require(CallerIdentity.Observe(current).InstalledSystem());
        }
        private void Expire(object ignored) { try { Dispose(); } catch { /* Sticky cleanupUnknown survives the callback. */ } }
        private void CloseResource(IDisposable resource) { if (resource != null) try { resource.Dispose(); } catch { cleanupUnknown = true; } }
        private void Stop(CallerLauncherNative.Created child)
        { if (child != null) { try { CallerLauncherNative.Stop(child); } catch { cleanupUnknown = true; } finally { CloseResource(child); } } }
        public void Dispose()
        {
            lock (gate)
            {
                if (closed) return; closed = true;
                if (supervisor != null && CallerNative.WaitForSingleObject(supervisor.Process, 0) == 0)
                    if (!GetExitCodeProcess(supervisor.Process, out supervisorExitCode)) cleanupUnknown = true;
                CloseResource(timer); Stop(main); Stop(supervisor);
                CloseResource(mainInput); CloseResource(supervisorOutput); CloseResource(supervisorInput);
                CloseResource(mainImage); CloseResource(supervisorImage); CloseResource(ownerImage);
                CloseResource(mainToken); CloseResource(token); CloseResource(supervisorToken); CloseResource(policy); CloseResource(service); CloseResource(self);
            }
        }
    }
}
