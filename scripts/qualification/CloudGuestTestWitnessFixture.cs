using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

// Synthetic native-completer models and actual disposable file sharing only. No logon/Job/VM.
public static class CloudGuestTestWitnessFixture
{
    private const string Sid = "S-1-5-21-101-102-103-104";
    private static readonly MethodInfo Complete = typeof(CloudGuestProcess).GetMethod("CompleteWitnessReceipt", BindingFlags.Static | BindingFlags.NonPublic);
    private static readonly MethodInfo Validate = typeof(CloudGuestTestWitness).GetMethod("Validate", BindingFlags.Static | BindingFlags.NonPublic);
    public static Dictionary<string, object> Model()
    {
        var value = new Dictionary<string, object>();
        foreach (string field in new string[] { "heldIdentityBeforeRelease", "runtimeResumed", "runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "taskReleased", "privateDesktopCreated", "privateDesktopParentRestored", "privateDesktopHandlesClosedAfterJobClosure", "witnessInputPinsVerified", "witnessEditedBytesVerified", "witnessInputsHeldThroughConfirmedClosure", "witnessInputHandlesClosed" }) value[field] = true;
        foreach (string field in new string[] { "witnessInputDisposalUnknown", "elevated", "administratorEnabled", "administratorGroupPresent" }) value[field] = false;
        value["sid"] = Sid; value["pid"] = (uint)42; value["birthFileTime"] = (long)43; value["initialJobMembers"] = 1; value["tokenRequestedAccess"] = 8;
        return value;
    }
    public static Dictionary<string, object> Decide(Dictionary<string, object> value, uint exit, bool observed, bool closure)
    {
        try { return (Dictionary<string, object>)Complete.Invoke(null, new object[] { value, exit, observed, closure, null, null }); }
        catch (TargetInvocationException error) { return CloudGuestProcess.FailureReceipt(error); }
    }
    public static bool Accept(Dictionary<string, object> value, string sid)
    { return (bool)Validate.Invoke(null, new object[] { value, sid }); }
    public static int PinControls(string freshDirectory)
    {
        string file = Path.Combine(freshDirectory, "pin.cjs"); string text = "module.exports = (a, b) => a + b;\n";
        File.WriteAllText(file, text, new UTF8Encoding(false)); string hash;
        using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").ToLowerInvariant();
        Type type = typeof(CloudGuestTestWitness).GetNestedType("Pin", BindingFlags.NonPublic);
        ConstructorInfo create = type.GetConstructor(BindingFlags.NonPublic | BindingFlags.Instance, null, new Type[] { typeof(string), typeof(string), typeof(long) }, null);
        object pin = create.Invoke(new object[] { file, hash, 256L });
        try {
            type.GetMethod("Recheck", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(pin, new object[0]);
            bool refused = false;
            try { using (var writer = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) writer.WriteByte(0); }
            catch (IOException) { refused = true; }
            if (!refused) throw new InvalidOperationException("pin-sharing-refused");
            typeof(CloudGuestTestWitness).GetMethod("ExactEdited", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, new object[] { pin });
        } finally { ((IDisposable)pin).Dispose(); }
        foreach (long maximum in new long[] { 1, 256 }) {
            bool refused = false;
            try { ((IDisposable)create.Invoke(new object[] { file, new string('0', 64), maximum })).Dispose(); }
            catch (TargetInvocationException error) { refused = error.InnerException is InvalidOperationException; }
            if (!refused) throw new InvalidOperationException("pin-negative-refused");
        }
        File.WriteAllText(file, "module.exports = (a, b) => a - b;\n", new UTF8Encoding(false));
        pin = create.Invoke(new object[] { file, null, 256L });
        try {
            bool refused = false;
            try { typeof(CloudGuestTestWitness).GetMethod("ExactEdited", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, new object[] { pin }); }
            catch (TargetInvocationException error) { refused = error.InnerException is InvalidOperationException; }
            if (!refused) throw new InvalidOperationException("edited-negative-refused");
        } finally { ((IDisposable)pin).Dispose(); }
        File.Delete(file); return 5;
    }
}
