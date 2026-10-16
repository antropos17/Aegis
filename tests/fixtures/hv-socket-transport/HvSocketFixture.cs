using System;
using System.Reflection;
using Aegis.ProtectedSession;

internal static class HvSocketFixture
{
    private static void Main(string[] args)
    {
        try
        {
            if (args.Length != 1) throw new InvalidOperationException("fixture-mode");
            if (args[0] == "production")
            {
                Type transport = typeof(HvSocketTransport);
                Require(transport.GetMethod("ConnectForTest", BindingFlags.Static | BindingFlags.NonPublic) == null);
                Require(transport.GetProperty("StopRequestedForTest", BindingFlags.Instance | BindingFlags.NonPublic) == null);
                Require(transport.GetMethod("LifetimeTickForTest", BindingFlags.Instance | BindingFlags.NonPublic) == null);
                Require(transport.GetField("BeforeUnlockForTest", BindingFlags.Instance | BindingFlags.NonPublic) == null);
                Require(transport.GetField("BeforeConnectUnlockForTest", BindingFlags.Static | BindingFlags.NonPublic) == null);
                foreach (Type type in transport.Assembly.GetTypes()) Require(type.Name != "ModeledSocket" && type.Name != "ModeledClock");
                Require(!transport.IsPublic && transport.GetConstructors(BindingFlags.Instance | BindingFlags.Public).Length == 0);
                Console.WriteLine("{\"passed\":true,\"nativeEffects\":0,\"injectedFactory\":false}"); return;
            }
#if HV_SOCKET_TEST
            Cases.Run(args[0]);
            Console.WriteLine("{\"passed\":true,\"nativeEffects\":0}");
#else
            throw new InvalidOperationException("fixture-production-only");
#endif
        }
        catch (Exception failure)
        {
            Console.Error.WriteLine("fixture-failure:" + failure.GetType().Name + ":" + failure.Message);
            Environment.ExitCode = 1;
        }
    }
    internal static void Require(bool value) { if (!value) throw new InvalidOperationException("fixture-assertion"); }
}
