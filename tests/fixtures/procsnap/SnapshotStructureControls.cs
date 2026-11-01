using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class SnapshotStructureControls {
    private const int EntrySize = 96;
    private const int Limit = 100000;
    private const long Birth = 134375611234567891L;
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern int GetCurrentProcessId();
    [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(IntPtr handle,
        out long create, out long exit, out long kernel, out long user);

    private static void Check(bool condition) {
        if (!condition) throw new InvalidOperationException("control-failed");
    }

    private static IntPtr Allocate(int count) {
        int bytes = checked(count * EntrySize);
        IntPtr buffer = Marshal.AllocHGlobal(bytes);
        Marshal.Copy(new byte[bytes], 0, buffer, bytes);
        return buffer;
    }

    private static void Row(IntPtr buffer, int index, int next, long pid, long birth) {
        IntPtr row = new IntPtr(buffer.ToInt64() + index * EntrySize);
        Marshal.WriteInt32(row, 0, next);
        Marshal.WriteInt64(row, 32, birth);
        Marshal.WriteIntPtr(row, 80, new IntPtr(pid));
        Marshal.WriteIntPtr(row, 88, new IntPtr(1));
    }

    private static string Render(IntPtr buffer, int size) {
        StringBuilder result = new StringBuilder();
        NtSnapshot.AppendProcesses(result, buffer, size);
        return result.ToString();
    }

    private static void Refused(IntPtr buffer, int size, string expected) {
        bool rejected = false;
        try { Render(buffer, size); }
        catch (InvalidOperationException error) { rejected = error.Message == expected; }
        Check(rejected);
    }

    private static void BufferCase(string name) {
        bool chain = name == "chain-boundary" || name == "chain-limit";
        int count = chain ? (name == "chain-limit" ? Limit + 1 : Limit) : 2;
        IntPtr buffer = Allocate(count);
        try {
            Row(buffer, 0, EntrySize, 47, Birth);
            Row(buffer, 1, 0, 48, Birth + 1);
            if (chain) {
                for (int index = 0; index < count; index++)
                    Row(buffer, index, index == count - 1 ? 0 : EntrySize,
                        index == 0 ? 47 : 0, index == 0 ? Birth : 0);
            }
            switch (name) {
                case "empty-return":
                    Refused(buffer, 0, "snapshot-entry-bounds"); break;
                case "short-first":
                    Refused(buffer, EntrySize - 1, "snapshot-entry-bounds"); break;
                case "truncated-later":
                    Refused(buffer, 2 * EntrySize - 1, "snapshot-entry-bounds"); break;
                case "oversized-next":
                    Row(buffer, 0, int.MaxValue, 47, Birth);
                    Refused(buffer, 2 * EntrySize, "snapshot-entry-bounds"); break;
                case "negative-next":
                    Row(buffer, 0, -EntrySize, 47, Birth);
                    Refused(buffer, 2 * EntrySize, "snapshot-negative-offset"); break;
                case "overlapping-next":
                    Row(buffer, 0, 1, 47, Birth);
                    Refused(buffer, 2 * EntrySize, "snapshot-overlapping-offset"); break;
                case "chain-limit":
                    Refused(buffer, count * EntrySize, "snapshot-chain-limit"); break;
                case "chain-boundary":
                    Check(Render(buffer, count * EntrySize) ==
                        "{\"pid\":47,\"ppid\":1,\"name\":\"\",\"ct\":\"134375611234567891\"}"); break;
                case "exact-births":
                    Check(Render(buffer, 2 * EntrySize) ==
                        "{\"pid\":47,\"ppid\":1,\"name\":\"\",\"ct\":\"134375611234567891\"}," +
                        "{\"pid\":48,\"ppid\":1,\"name\":\"\",\"ct\":\"134375611234567892\"}"); break;
                case "unknown-birth":
                    Row(buffer, 0, 0, 47, 0);
                    Check(Render(buffer, EntrySize) == "{\"pid\":47,\"ppid\":1,\"name\":\"\"}"); break;
                case "terminal-row":
                    Row(buffer, 0, 0, 47, Birth);
                    Check(Render(buffer, EntrySize) ==
                        "{\"pid\":47,\"ppid\":1,\"name\":\"\",\"ct\":\"134375611234567891\"}"); break;
                default: throw new InvalidOperationException("unknown-control");
            }
        } finally { Marshal.FreeHGlobal(buffer); }
    }

    private static void LiveSelf() {
        Check(NtSnapshot.Probe() == null);
        long birth, exit, kernel, user;
        Check(GetProcessTimes(GetCurrentProcess(), out birth, out exit, out kernel, out user));
        string wire = NtSnapshot.SnapshotJson(19);
        Check(wire.StartsWith("{\"t\":\"snap\",\"id\":19,\"source\":\"class5\",\"procs\":[", StringComparison.Ordinal));
        string key = "\"pid\":" + GetCurrentProcessId().ToString(CultureInfo.InvariantCulture) + ",";
        int start = wire.IndexOf(key, StringComparison.Ordinal);
        Check(start >= 0);
        int end = wire.IndexOf('}', start);
        Check(end > start);
        string ownRow = "{" + wire.Substring(start, end - start + 1);
        Check(Json.ReadStringField(ownRow, "ct") == birth.ToString(CultureInfo.InvariantCulture));
        Check(NtSnapshot.LastDurationUs >= 0);
        // The raw process table and other processes' names never leave this process.
    }

    public static int Main(string[] args) {
        if (args.Length != 1) return 2;
        try {
            if (args[0] == "live-self") LiveSelf(); else BufferCase(args[0]);
            Console.WriteLine("{\"case\":\"" + args[0] + "\",\"passed\":true}");
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine("control-failed:" + error.GetType().Name);
            return 1;
        }
    }
}
