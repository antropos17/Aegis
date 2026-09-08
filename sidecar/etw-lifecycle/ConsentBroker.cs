using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record ConsentResult(bool Live, string Scenario, string Outcome,
    bool RestrictedAcl, bool ExpiredBeforeReturn, bool LaunchReturned, bool ChildLaunched,
    bool ChildIdentityVerified, int? ChildExitCode, int? NativeError, bool InjectedDenial,
    bool AuthorizationSent, double LaunchElapsedMilliseconds, string? Error);

// Negative launch probes. These never send authorize, including unexpected early consent.
internal static class ConsentBroker
{
    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 3 || args[1] is not ("live" or "check") ||
            args[2] is not ("refusal" or "late") || Security.Current().Elevated) return 3;
        bool live = args[1] == "live"; string scenario = args[2];
        string id = Guid.NewGuid().ToString("N"), receiptId = Guid.NewGuid().ToString("N");
        using var pipe = Security.Server(id);
        using var receipt = Security.Server(receiptId);
        bool acl = Security.RestrictedAcl(pipe) && Security.RestrictedAcl(receipt);
        if (!acl) throw new UnauthorizedAccessException();
        var self = Security.Current();
        var info = Program.Child("peer", live ? "live" : "check", id,
            self.Pid.ToString(CultureInfo.InvariantCulture), self.Birth.ToString(CultureInfo.InvariantCulture), "normal", receiptId);
        if (live)
        {
            info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardInput = false; info.RedirectStandardOutput = false; info.RedirectStandardError = false;
        }
        // Expiry revokes the channels while ShellExecute may still be waiting for consent.
        // This does not claim to cancel the OS dialog or its eventual process launch.
        TimeSpan budget = TimeSpan.FromMilliseconds(live ? 5000 : 50);
        using var expiry = new CancellationTokenSource(budget);
        using var closeOnExpiry = expiry.Token.Register(() => { pipe.Dispose(); receipt.Dispose(); });
        Process? child = null;
        bool returned = false, expired = false, verified = false;
        int? nativeError = null, exit = null;
        string outcome = "incomplete";
        string? error = null;
        var elapsed = Stopwatch.StartNew();
        double launchMilliseconds = 0;
        try
        {
            if (!live && scenario == "refusal") throw new Win32Exception(1223);
            if (!live && scenario == "late") await Task.Delay(150); // explicit normal-token scheduling fixture
            child = Process.Start(info) ?? throw new InvalidOperationException();
            returned = true;
            launchMilliseconds = elapsed.Elapsed.TotalMilliseconds;
            expired = elapsed.Elapsed >= budget;
            // Close immediately on every returned launch; early consent must also remain harmless.
            pipe.Dispose(); receipt.Dispose();
            outcome = expired ? "late-consent" : "early-consent";
            try
            {
                var identity = Security.Observe(child);
                verified = identity.Image.Equals(Program.Executable, StringComparison.OrdinalIgnoreCase) &&
                    identity.User == self.User && identity.Logon == self.Logon && identity.Elevated == live;
            }
            catch (Win32Exception) { /* A fast rejection may exit before token observation; retain unknown identity. */ }
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await child.WaitForExitAsync(deadline.Token);
            exit = child.ExitCode; // retained ShellExecute/CreateProcess handle, never reopened PID
        }
        catch (Win32Exception failure) when (child == null)
        {
            returned = true; nativeError = failure.NativeErrorCode;
            launchMilliseconds = elapsed.Elapsed.TotalMilliseconds;
            expired = elapsed.Elapsed >= budget;
            outcome = nativeError == 1223 ? "uac-denied" : "launch-failed";
            if (nativeError != 1223) error = Program.ErrorCode(failure);
        }
        catch (Exception failure) { error = Program.ErrorCode(failure); }
        finally { pipe.Dispose(); receipt.Dispose(); }
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(new ConsentResult(live, scenario, outcome, acl,
                expired, returned, child != null, verified, exit, nativeError, !live && scenario == "refusal",
                false, launchMilliseconds, error)));
        }
        finally { child?.Dispose(); }
        return error == null ? 0 : 2;
    }
}
