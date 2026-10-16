#if PROTECTED_GUI_TEST && PROTECTED_GUI_PROCESS_TEST
using System;
using System.IO;

// Fixture controls only: all filesystem/process effects below are real. The
// callback dispatch and missing closure acknowledgment are explicitly modeled.
public static class ProcessTestControls
{
    public static string AttemptPath { get; private set; }
    public static bool ReplacementAttempted { get; private set; }
    public static bool ReplacementRefused { get; private set; }
    public static bool ExecutionSubstitutionAttempted { get; private set; }
    public static string ExecutionOriginalIdentity { get; private set; }
    public static string ExecutionReplacementIdentity { get; private set; }
    public static string FileIdentity(string path)
    {
        using (var file = new ProtectedInstallFile(path, false, false)) return file.Volume + ":" + file.FileId;
    }
    public static void ArmExecutionSubstitution(string payload, string retainedOriginal)
    {
        Clear();
        ProtectedGuiBundleNative.BeforeExecutionLinkForTest = delegate(string path)
        {
            if (!String.Equals(path, payload, StringComparison.OrdinalIgnoreCase)) return;
            ProtectedGuiBundleNative.BeforeExecutionLinkForTest = null;
            ExecutionOriginalIdentity = FileIdentity(path);
            File.Move(path, retainedOriginal);
            using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var writer = new StreamWriter(file)) writer.Write("foreign-execution-link");
            ExecutionReplacementIdentity = FileIdentity(path);
            ExecutionSubstitutionAttempted = true;
        };
    }
    public static void FailClosureAcknowledgment()
    { ProtectedGuiProcessNative.FailStopAcknowledgmentForTest = true; }
    public static void ArmPreexistingAttempt()
    {
        Clear();
        ProtectedGuiProcessProfile.BeforeAttemptCreateForTest = delegate(string path)
        {
            AttemptPath = path; Directory.CreateDirectory(path);
            File.WriteAllText(Path.Combine(path, "foreign-profile-canary"), "original-foreign-data");
        };
    }
    public static void ArmReplacementAttempt()
    {
        Clear();
        ProtectedGuiProcessProfile.AfterAttemptCreateForTest = delegate(string path)
        {
            AttemptPath = path; ReplacementAttempted = true;
            try { Directory.Move(path, path + "-replacement"); }
            catch (IOException) { ReplacementRefused = true; }
        };
    }
    public static void ArmNaturalExit()
    {
        Clear();
        ProtectedGuiProcessProfile.AfterAttemptCreateForTest = delegate(string path)
        {
            AttemptPath = path; File.WriteAllText(Path.Combine(path, "fixture-control"), "natural-exit");
        };
    }
    public static void Clear()
    {
        ProtectedGuiProcessProfile.BeforeAttemptCreateForTest = null;
        ProtectedGuiProcessProfile.AfterAttemptCreateForTest = null;
        ProtectedGuiBundleNative.BeforeExecutionLinkForTest = null;
        ReplacementAttempted = false; ReplacementRefused = false; AttemptPath = null;
        ExecutionSubstitutionAttempted = false; ExecutionOriginalIdentity = null; ExecutionReplacementIdentity = null;
    }
}
#endif
