using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Aegis.ProtectedSession;

internal static class GuestJobFixture
{
    private static string phase = "arguments";
    private static string Image { get { return typeof(GuestJobFixture).Assembly.Location; } }
    private static string[] Images { get { return new string[] { Image, Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"), "System32", "conhost.exe") }; } }
    private static void Require(bool value) { if (!value) throw new InvalidDataException("fixture-failed"); }
    private static bool Refused(Action action) { try { action(); return false; } catch (InvalidDataException) { return true; } }
    private static int Worker(string mode)
    {
        if (mode == "leaf") { System.Threading.Thread.Sleep(10000); return 0; }
        Console.WriteLine("ready"); Console.Out.Flush();
        while (true)
        {
            string command = Console.ReadLine();
            if (command == null) return 0;
            if (command == "spawn")
            {
                for (int index = 0; index < 3; index++)
                    using (var child = Process.Start(new ProcessStartInfo(Image, "--worker leaf") { UseShellExecute = false, CreateNoWindow = true })) Require(child != null);
                System.Threading.Thread.Sleep(100);
                Console.WriteLine("spawned"); Console.Out.Flush();
            }
        }
    }
    private static void Read(Native.Session child, string expected)
    {
        var clock = Stopwatch.StartNew(); string text = ""; var bytes = new byte[128];
        while (clock.ElapsedMilliseconds < 2000 && !text.EndsWith("\n", StringComparison.Ordinal))
        {
            int count = Native.ReadAvailable(child.Output, child.Output.SafeFileHandle.DangerousGetHandle(), bytes);
            Require(count >= 0 && text.Length + count <= 128);
            if (count > 0) text += System.Text.Encoding.UTF8.GetString(bytes, 0, count);
            else System.Threading.Thread.Sleep(10);
        }
        Require(text.Trim() == expected);
    }
    private static void Spawn(Native.Session child)
    {
        byte[] bytes = System.Text.Encoding.ASCII.GetBytes("spawn\n"); child.Input.Write(bytes, 0, bytes.Length); child.Input.Flush(); Read(child, "spawned");
    }
    private static bool Decode(string mode)
    {
        IntPtr data = Marshal.AllocHGlobal(8 + 2 * IntPtr.Size);
        try
        {
            uint assigned = mode == "cap" ? 65u : 2u;
            uint listed = mode == "partial" ? 1u : 2u;
            Marshal.WriteInt32(data, 0, (int)assigned); Marshal.WriteInt32(data, 4, (int)listed);
            Marshal.WriteIntPtr(data, 8, new IntPtr(10));
            Marshal.WriteIntPtr(data, 8 + IntPtr.Size, new IntPtr(mode == "duplicate" ? 10 : 0));
            return Refused(delegate { GuestJobNative.DecodeMembers(data, 2); });
        }
        finally { Marshal.FreeHGlobal(data); }
    }
    private static int Main(string[] args)
    {
        try
        {
            Require(args.Length == 1 || (args.Length == 2 && args[0] == "--worker"));
            if (args.Length == 2) return Worker(args[1]);
            string mode = args[0];
            if (mode == "partial" || mode == "cap" || mode == "duplicate" || mode == "zero-pid")
            {
                Require(Decode(mode)); Console.WriteLine("{\"refused\":true,\"syntheticDecode\":true}"); return 0;
            }
            Native.Session child = null; GuestJobInventory inventory = null;
            try
            {
                child = Native.Start(Image, Path.GetDirectoryName(Image), new string[] { "--worker", "root" }, "SystemRoot=" + Environment.GetEnvironmentVariable("SystemRoot") + "\0\0");
                phase = "ready"; Read(child, "ready");
                if (mode == "growth") Spawn(child);
                bool refused = false, closed = false, killOnClose = false;
                if (mode == "foreign")
                {
                    using (var self = Process.GetCurrentProcess()) refused = Refused(delegate { using (new GuestJobInventory(child.Job, self.Handle, Images)) { } });
                }
                else if (mode == "wrong-image") refused = Refused(delegate { using (new GuestJobInventory(child.Job, child.Process, new string[] { "Z:\\never.exe" })) { } });
                else
                {
                    phase = "capture"; inventory = new GuestJobInventory(child.Job, child.Process, Images); inventory.ValidateInitial();
                    Require(!inventory.ConfirmClosure(0));
                    if (mode == "late-member") { Spawn(child); refused = Refused(inventory.ValidateInitial); }
                    if (mode == "exited") { Require(child.TerminateAndVerify()); refused = Refused(inventory.ValidateInitial); }
                    if (mode == "disposed") { inventory.Dispose(); refused = Refused(inventory.ValidateInitial); Require(!inventory.ConfirmClosure(0)); }
                    if (mode == "close-owner")
                    {
                        Require(GuestJobNative.CloseHandle(child.Job)); child.Job = IntPtr.Zero;
                        // Observer duplicate preserves the Job until explicitly disposed.
                        inventory.ValidateInitial(); inventory.Dispose();
                        Require(Native.WaitForSingleObject(child.Process, 2000) == 0); killOnClose = true;
                    }
                    else if (mode != "disposed") { Require(child.TerminateAndVerify()); closed = inventory.ConfirmClosure(2000); Require(closed); }
                    if (mode == "growth") Require(inventory.InitialCount >= 4);
                }
                Require(mode == "positive" || mode == "growth" || mode == "close-owner" || refused);
                Console.WriteLine("{\"refused\":" + (refused ? "true" : "false") + ",\"closureConfirmed\":" + (closed ? "true" : "false") + ",\"killOnCloseObserved\":" + (killOnClose ? "true" : "false") + "}"); return 0;
            }
            finally
            {
                if (child != null) { try { if (child.Job != IntPtr.Zero) child.TerminateAndVerify(); } finally { if (inventory != null) inventory.Dispose(); child.Dispose(); } }
            }
        }
        catch (Exception error) { Console.Error.WriteLine("guest-job-fixture-unavailable:" + phase + ":" + error.GetType().Name); return 2; }
    }
}
