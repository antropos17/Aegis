using System;
using System.IO;
using System.Diagnostics;
using Aegis.ProtectedSession;

internal static class FixedOperationParser
{
    private static int Main(string[] args)
    {
        if (args[0] == "--operator-sid")
        {
            using (var current = Process.GetCurrentProcess())
            using (var held = CallerNative.Duplicate(current.Handle))
            using (var token = CallerNative.ProcessToken(held))
                Console.WriteLine("{\"sid\":\"" + CallerIdentity.Observe(token).OperatorSid + "\"}");
            return 0;
        }
        bool attempted = false, accepted = false;
        try
        {
            using (var policy = FixedOperationRecords.Policy(args[0]))
            {
                byte[] operation = File.ReadAllBytes(Path.Combine(args[0], "registered-operation.json"));
                byte[] fixture = File.ReadAllBytes(Path.Combine(args[0], "fixed-fixture.json"));
                attempted = true;
                InstalledFixedOperationRegistration.ParseForTest(operation, fixture, policy);
                accepted = true;
            }
        }
        catch (InvalidDataException) { }
        catch (InvalidOperationException) { }
        catch (ArgumentException) { }
        Console.WriteLine("{\"parserAttempted\":" + attempted.ToString().ToLowerInvariant() + ",\"accepted\":" + accepted.ToString().ToLowerInvariant() + "}");
        return 0;
    }
}
