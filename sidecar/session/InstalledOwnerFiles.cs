using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal static class InstalledOwnerFiles
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string path,
            uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, byte[] bytes, uint length);
        internal static string ReceiptName(InstalledOwnerPolicy policy, string name)
        {
            CallerNative.Require(policy != null && (name == "owner-result.json" || name == "inspection-count.txt"));
            string suffix = "-" + policy.InstallId + "-" + policy.Epoch + "-" + policy.Revision;
            return Path.GetFileNameWithoutExtension(name) + suffix + Path.GetExtension(name);
        }
        internal static void RequireFreshReceipts(InstalledOwnerPolicy policy)
        {
            using (EnrollmentHeld directory = new EnrollmentNative().Open(InstalledOwnerPolicy.Receipts, true))
            {
                EnrollmentInspection.Check(directory, InstalledOwnerPolicy.Receipts, true, false);
                foreach (string name in new[] { "owner-result.json", "inspection-count.txt" })
                    CallerNative.Require(!File.Exists(Path.Combine(InstalledOwnerPolicy.Receipts, ReceiptName(policy, name))));
                directory.Recheck(false);
            }
        }
        internal static int InspectionCount(InstalledOwnerPolicy policy)
        {
            string path = Path.Combine(InstalledOwnerPolicy.Receipts, ReceiptName(policy, "inspection-count.txt"));
            if (!File.Exists(path)) return 0;
            using (EnrollmentHeld count = new EnrollmentNative().Open(path, false))
            {
                EnrollmentInspection.Check(count, path, false, false); byte[] bytes = count.Read(16);
                CallerNative.Require(bytes.Length == 1 && bytes[0] == (byte)'1'); count.Recheck(false); return 1;
            }
        }
        internal static void WriteNew(bool receipt, string name, string text, InstalledOwnerPolicy policy = null)
        {
            CallerNative.Require(receipt ? name == "owner-result.json" || name == "inspection-count.txt" : name == "main-registration.json");
            if (receipt) name = ReceiptName(policy, name);
            byte[] bytes = new UTF8Encoding(false, true).GetBytes(text); CallerNative.Require(bytes.Length > 0 && bytes.Length <= 4096);
            string directory = receipt ? InstalledOwnerPolicy.Receipts : InstalledOwnerPolicy.Root;
            var pinned = new List<EnrollmentHeld>();
            try
            {
                var paths = new List<string>(); string cursor = directory;
                while (cursor != null) { paths.Add(cursor); CallerNative.Require(paths.Count <= 32); cursor = Path.GetDirectoryName(cursor); }
                paths.Reverse(); var native = new EnrollmentNative();
                foreach (string path in paths)
                {
                    EnrollmentHeld item = native.Open(path, true); pinned.Add(item);
                    EnrollmentInspection.Check(item, path, true, path != directory);
                }
                // One-use leaves: an old receipt/role is a refusal, never an implicit reuse or overwrite.
                using (SafeFileHandle file = CreateFile(Path.Combine(directory, name), 0x40020000, 1, IntPtr.Zero, 1, 0x00200000, IntPtr.Zero))
                {
                    CallerNative.Require(!file.IsInvalid); byte[] tag = new byte[8];
                    CallerNative.Require(GetFileInformationByHandleEx(file, 9, tag, 8) && (BitConverter.ToUInt32(tag, 0) & 0x410) == 0);
                    using (var stream = new FileStream(file, FileAccess.Write)) { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
                }
            }
            finally { for (int index = pinned.Count - 1; index >= 0; index--) pinned[index].Dispose(); Array.Clear(bytes, 0, bytes.Length); }
        }
        internal static string Inventory(InstalledOwnerPolicy policy)
        { return "{\"schemaVersion\":1,\"installId\":\"" + policy.InstallId + "\",\"revision\":" + policy.Revision + ",\"epoch\":\"" + policy.Epoch +
            "\",\"selections\":[{\"id\":\"" + policy.SelectionId + "\",\"epoch\":\"" + policy.SelectionEpoch + "\",\"operation\":\"inspect-owned\"}]}"; }
        internal static void PublishMain(InstalledOwnerPolicy policy, CallerIdentity actual)
        {
            CallerNative.Require(actual.InstalledOperator(policy.OperatorSid)); policy.CheckCurrent();
            string inventoryPath = Path.Combine(InstalledOwnerPolicy.Root, "inventory.json"); byte[] expected = Encoding.UTF8.GetBytes(Inventory(policy));
            using (EnrollmentHeld inventory = new EnrollmentNative().Open(inventoryPath, false))
            {
                EnrollmentInspection.Check(inventory, inventoryPath, false, false); byte[] current = inventory.Read(4096);
                CallerNative.Require(current.Length == expected.Length);
                for (int index = 0; index < current.Length; index++) CallerNative.Require(current[index] == expected[index]);
                inventory.Recheck(false);
                string role = "{\"schemaVersion\":1,\"installId\":\"" + policy.InstallId + "\",\"revision\":" + policy.Revision + ",\"epoch\":\"" + policy.Epoch +
                    "\",\"role\":\"controller-main\",\"protocol\":\"aegis-supervisor-caller\",\"protocolVersion\":1,\"operatorSid\":\"" + actual.OperatorSid +
                    "\",\"operatorAuthentication\":\"" + actual.OperatorAuthentication + "\",\"operatorSession\":" + actual.OperatorSession +
                    ",\"mainImageSize\":" + policy.MainSize + ",\"mainImageSha256\":\"" + policy.MainHash + "\",\"inventorySha256\":\"" + EnrollmentInspection.ImageHash(current) + "\"}";
                WriteNew(false, "main-registration.json", role);
            }
        }
    }
}
