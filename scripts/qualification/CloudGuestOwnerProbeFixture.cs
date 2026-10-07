using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;

// Real harmless native leaf processes, same current principal; no accounts/ACL/VM.
internal static class CloudGuestOwnerProbeFixture
{
    private static void Require(bool value) { if (!value) throw new InvalidOperationException("owner-probe-control-refused"); }
    private static int Main(string[] arguments)
    {
        string image = Assembly.GetExecutingAssembly().Location;
        if (arguments.Length == 1 && arguments[0] == "--version")
        {
            string leaf = Path.GetFileName(image);
            if (leaf == "slow-node.exe") Thread.Sleep(3500);
            else if (leaf == "timeout-node.exe") Thread.Sleep(4000);
            else if (leaf == "stderr-node.exe") Console.Error.Write("private-fixture-text");
            else if (leaf != "good-node.exe") return 2;
            Console.WriteLine("v22.23.3"); return 0;
        }
        if (arguments.Length != 0) return 2;
        try
        {
            string root = Path.GetDirectoryName(image);
            Require(Path.GetFileName(root).StartsWith("aegis-owner-probe-", StringComparison.Ordinal));
            var method = typeof(CloudGuestDesktop).GetMethod("ObserveOwnerVersion", BindingFlags.Static | BindingFlags.NonPublic);
            Require(method != null);
            int controls = 0;
            foreach (string mode in new string[] { "slow", "timeout", "stderr", "good" })
            {
                var receipt = new Dictionary<string, object>(); bool threw = false;
                int budget = mode == "slow" ? 5000 : mode == "timeout" ? 1000 : 3000;
                try { method.Invoke(null, new object[] { Path.Combine(root, mode + "-node.exe"), root, root, receipt, budget }); }
                catch (TargetInvocationException) { threw = true; }
                bool positive = mode == "slow" || mode == "good";
                Require((bool)receipt["ownerNodeVersionPassed"] == positive && threw != positive);
                Require((bool)receipt["ownerNodeVersionStarted"] && (bool)receipt["ownerNodeVersionCleanupConfirmed"] &&
                    (bool)receipt["ownerNodeVersionCleanupExitObserved"]);
                if (positive)
                {
                    Require((bool)receipt["ownerNodeVersionExitObserved"] && (int)receipt["ownerNodeVersionExitCode"] == 0 &&
                        !(bool)receipt["ownerNodeVersionTerminationAttempted"] && (string)receipt["ownerNodeVersionStage"] == "verified" &&
                        (string)receipt["ownerNodeVersion"] == "v22.23.3");
                    if (mode == "slow") Require((long)receipt["ownerNodeVersionElapsedMilliseconds"] >= 3500);
                }
                else if (mode == "timeout")
                {
                    Require((bool)receipt["ownerNodeVersionTimedOut"] && (bool)receipt["ownerNodeVersionTerminationAttempted"] &&
                        !(bool)receipt["ownerNodeVersionExitObserved"] && (string)receipt["ownerNodeVersionStage"] == "deadline");
                }
                else Require((string)receipt["ownerNodeVersionStage"] == "stderr-present" && (int)receipt["ownerNodeVersionStderrBytes"] == 1);
                string text = new JavaScriptSerializer().Serialize(receipt);
                Require(text.Length <= 2048 && !text.Contains("private-fixture-text"));
                Console.WriteLine("{\"case\":\"" + mode + "\",\"receipt\":" + text + "}"); controls++;
            }
            Console.WriteLine("{\"nativeControls\":" + controls + ",\"guestNodeQualified\":false,\"launchAllowed\":false}"); return 0;
        }
        catch (Exception error) { Console.WriteLine("{\"fixtureFailed\":true,\"hResult\":" + error.HResult + "}"); return 1; }
    }
}
