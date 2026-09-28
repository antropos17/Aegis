using System;
using System.Runtime.InteropServices;
using System.Text;

// Diagnostic only: tokens and security descriptors stay in memory. No token is
// assigned, no impersonation occurs, and no file/process/host ACL is changed.
internal static class FilesystemAccessCheckProbe
{
    [StructLayout(LayoutKind.Sequential)] private struct LUID { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] private struct PRIVILEGE { public LUID Id; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct SID_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct GENERIC_MAPPING { public uint Read, Write, Execute, All; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct OS_VERSION
    {
        public uint Size, Major, Minor, Build, Platform;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string ServicePack;
    }
    [DllImport("ntdll.dll", CharSet = CharSet.Unicode)] private static extern int RtlGetVersion(ref OS_VERSION version);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int needed);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool CreateRestrictedToken(IntPtr token, uint flags, int disabledCount, IntPtr disabled, int privilegeCount, IntPtr privileges, int sidCount, ref SID_ATTRIBUTES sid, out IntPtr result);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int level, int kind, out IntPtr result);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool LookupPrivilegeValue(string system, string name, out LUID id);
    [DllImport("advapi32.dll")] private static extern bool EqualSid(IntPtr first, IntPtr second);
    [DllImport("advapi32.dll")] private static extern bool IsTokenRestricted(IntPtr token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr text);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
    [DllImport("advapi32.dll")] private static extern bool IsValidAcl(IntPtr acl);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool AccessCheck(IntPtr descriptor, IntPtr token, uint desired, ref GENERIC_MAPPING mapping, IntPtr privileges, ref uint size, out uint granted, out bool allowed);

    private static void Check(bool condition) { if (!condition) throw new InvalidOperationException(); }
    private static bool Same(LUID first, LUID second) { return first.Low == second.Low && first.High == second.High; }
    private static string Boolean(bool value) { return value ? "true" : "false"; }

    private static IntPtr Information(IntPtr token, int kind)
    {
        int size;
        GetTokenInformation(token, kind, IntPtr.Zero, 0, out size);
        Check(size >= 4 && size <= 65536);
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try { Check(GetTokenInformation(token, kind, buffer, size, out size)); return buffer; }
        catch { Marshal.FreeHGlobal(buffer); throw; }
    }

    private static string Decision(IntPtr descriptor, IntPtr token, uint desired)
    {
        GENERIC_MAPPING mapping = new GENERIC_MAPPING();
        mapping.Read = 0x120089; mapping.Write = 0x120116;
        mapping.Execute = 0x1200a0; mapping.All = 0x1f01ff;
        IntPtr privileges = Marshal.AllocHGlobal(1024);
        try
        {
            uint size = 1024, granted;
            bool allowed;
            Check(AccessCheck(descriptor, token, desired, ref mapping, privileges,
                ref size, out granted, out allowed));
            return "{\"allowed\":" + Boolean(allowed) + ",\"grantedMask\":" + granted + "}";
        }
        finally { Marshal.FreeHGlobal(privileges); }
    }

    private static string Row(string label, string sddl, string operation, uint desired,
        IntPtr ordinary, IntPtr restricted)
    {
        IntPtr descriptor;
        uint size;
        Check(ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out descriptor, out size));
        try
        {
            bool present, defaulted;
            IntPtr dacl;
            Check(GetSecurityDescriptorDacl(descriptor, out present, out dacl, out defaulted));
            string kind = "absent";
            if (present)
            {
                if (dacl == IntPtr.Zero) kind = "null";
                else
                {
                    Check(IsValidAcl(dacl));
                    kind = Marshal.ReadInt16(dacl, 4) == 0 ? "empty" : "allocated";
                }
            }
            return "{\"descriptor\":\"" + label + "\",\"operation\":\"" + operation +
                "\",\"desiredMask\":" + desired + ",\"daclKind\":\"" + kind +
                "\",\"ordinary\":" + Decision(descriptor, ordinary, desired) +
                ",\"restricted\":" + Decision(descriptor, restricted, desired) + "}";
        }
        finally { LocalFree(descriptor); }
    }

    private static int Main(string[] arguments)
    {
        if (arguments.Length != 0) return 2;
        IntPtr original = IntPtr.Zero, restricted = IntPtr.Zero;
        IntPtr ordinaryCopy = IntPtr.Zero, restrictedCopy = IntPtr.Zero;
        IntPtr user = IntPtr.Zero, privileges = IntPtr.Zero, removals = IntPtr.Zero;
        IntPtr groups = IntPtr.Zero, remaining = IntPtr.Zero, sidText = IntPtr.Zero;
        try
        {
            Check(IntPtr.Size == 8);
            OS_VERSION version = new OS_VERSION();
            version.Size = (uint)Marshal.SizeOf(typeof(OS_VERSION));
            version.ServicePack = string.Empty;
            Check(RtlGetVersion(ref version) == 0 && version.Build > 0);
            Check(OpenProcessToken(GetCurrentProcess(), 0x000a, out original));
            user = Information(original, 1);
            IntPtr userSid = Marshal.ReadIntPtr(user);
            Check(ConvertSidToStringSid(userSid, out sidText));
            string principal = Marshal.PtrToStringUni(sidText);
            LUID traversal;
            Check(LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out traversal));
            privileges = Information(original, 3);
            int count = Marshal.ReadInt32(privileges), stride = Marshal.SizeOf(typeof(PRIVILEGE));
            Check(count >= 0 && count <= 256);
            removals = Marshal.AllocHGlobal(Math.Max(1, count) * stride);
            int removed = 0;
            for (int i = 0; i < count; i++)
            {
                PRIVILEGE entry = (PRIVILEGE)Marshal.PtrToStructure(IntPtr.Add(privileges, 4 + i * stride), typeof(PRIVILEGE));
                if (!Same(entry.Id, traversal))
                { Marshal.StructureToPtr(entry, IntPtr.Add(removals, removed * stride), false); removed++; }
            }
            SID_ATTRIBUTES restrictor = new SID_ATTRIBUTES(); restrictor.Sid = userSid;
            Check(CreateRestrictedToken(original, 0, 0, IntPtr.Zero, removed, removals, 1, ref restrictor, out restricted));
            groups = Information(restricted, 11);
            Check(Marshal.ReadInt32(groups) == 1 && EqualSid(Marshal.ReadIntPtr(groups, 8), userSid));
            Check(IsTokenRestricted(restricted));
            remaining = Information(restricted, 3);
            int remainingCount = Marshal.ReadInt32(remaining);
            Check(remainingCount >= 0 && remainingCount <= 1);
            bool hasTraversal = remainingCount == 1;
            if (hasTraversal)
            {
                PRIVILEGE entry = (PRIVILEGE)Marshal.PtrToStructure(IntPtr.Add(remaining, 4), typeof(PRIVILEGE));
                Check(Same(entry.Id, traversal));
            }
            // Unassigned impersonation token objects are required by AccessCheck.
            // Neither duplicate is ever used as a thread/process execution token.
            Check(DuplicateTokenEx(original, 8, IntPtr.Zero, 2, 2, out ordinaryCopy));
            Check(DuplicateTokenEx(restricted, 8, IntPtr.Zero, 2, 2, out restrictedCopy));
            string[] labels = { "everyone", "principal", "empty", "null", "absent" };
            string[] descriptors = { "O:SYG:SYD:(A;;0x10003;;;WD)",
                "O:SYG:SYD:(A;;0x10003;;;" + principal + ")", "O:SYG:SYD:",
                "O:SYG:SYD:NO_ACCESS_CONTROL", "O:SYG:SY" };
            string[] operations = { "read-data", "write-data", "delete" };
            uint[] desired = { 1, 2, 0x10000 };
            StringBuilder rows = new StringBuilder();
            for (int i = 0; i < labels.Length; i++)
                for (int j = 0; j < operations.Length; j++)
                {
                    if (rows.Length != 0) rows.Append(',');
                    rows.Append(Row(labels[i], descriptors[i], operations[j], desired[j], ordinaryCopy, restrictedCopy));
                }
            int[] transition = { 0, 3, 2 };
            for (int i = 0; i < transition.Length; i++)
            {
                int chosen = transition[i];
                rows.Append(',').Append(Row("transition-" + labels[chosen], descriptors[chosen],
                    "read-data", 1, ordinaryCopy, restrictedCopy));
            }
            Console.Out.Write("{\"version\":1,\"scope\":\"in-memory-access-check\",\"osBuild\":" +
                version.Build + ",\"flags\":0,\"restrictorCount\":1," +
                "\"restrictorEqualsUser\":true,\"isRestricted\":true,\"remainingPrivilegeCount\":" +
                remainingCount + ",\"hasTraversalPrivilege\":" + Boolean(hasTraversal) +
                ",\"cases\":[" + rows + "]}");
            return 0;
        }
        catch { Console.Error.Write("filesystem-probe-unavailable"); return 2; }
        finally
        {
            foreach (IntPtr buffer in new[] { user, privileges, removals, groups, remaining })
                if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            if (sidText != IntPtr.Zero) LocalFree(sidText);
            foreach (IntPtr token in new[] { restrictedCopy, ordinaryCopy, restricted, original })
                if (token != IntPtr.Zero) CloseHandle(token);
        }
    }
}
