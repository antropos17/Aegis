/**
 * @file platform/rm-csharp.js
 * @module main/platform/rm-csharp
 * @description The C# Windows Restart Manager (rstrtmgr.dll) P/Invoke wrapper
 *   source, compiled per spawn via Add-Type inside restart-manager.js and into the
 *   native observer sidecar. Extracted to its own module to keep both transports
 *   on the same Restart Manager contract.
 *
 *   The wrapper exposes a single static GetHolders(string[] files) → Holder[]
 *   with each PID and its exact creation FILETIME. It uses the two-call RmGetList
 *   protocol: ERROR_MORE_DATA is an expected sizing result, while other API
 *   failures throw so a failed observation cannot appear empty and healthy.
 *
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.10.0
 */
'use strict';

/**
 * The C# Restart Manager wrapper compiled once per spawn via Add-Type. Exposes
 * a single static GetHolders(string[] files) → Holder[] of PID/birth pairs. Uses the
 * two-call RmGetList protocol, checking both calls for failures.
 * @type {string}
 */
const RM_CSHARP = [
  'using System;',
  'using System.Collections.Generic;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public static class AegisRm {',
  '  public sealed class Holder { public int pid { get; set; } public string createTime100ns { get; set; } }',
  '  [StructLayout(LayoutKind.Sequential)] struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }',
  '  const int RM_INVALID_SESSION = -1;',
  '  const int CCH_RM_SESSION_KEY = 32;',
  '  const int CCH_RM_MAX_APP_NAME = 255;',
  '  const int CCH_RM_MAX_SVC_NAME = 63;',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct RM_PROCESS_INFO {',
  '    public RM_UNIQUE_PROCESS Process;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)] public string strAppName;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)] public string strServiceShortName;',
  '    public int ApplicationType; public uint AppStatus; public uint TSSessionId;',
  '    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;',
  '  }',
  '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);',
  '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, IntPtr rgApplications, uint nServices, string[] rgsServiceNames);',
  '  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, out uint lpdwRebootReasons);',
  '  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint pSessionHandle);',
  '  public static Holder[] GetHolders(string[] files) {',
  '    var holders = new List<Holder>();',
  '    if (files == null || files.Length == 0) return holders.ToArray();',
  '    uint session; var key = new StringBuilder(CCH_RM_SESSION_KEY + 1);',
  '    if (RmStartSession(out session, 0, key) != 0) throw new InvalidOperationException("RmStartSession failed");',
  '    try {',
  '      if (RmRegisterResources(session, (uint)files.Length, files, 0, IntPtr.Zero, 0, null) != 0) throw new InvalidOperationException("RmRegisterResources failed");',
  '      uint needed = 0, count = 0, reason = 0;',
  '      int firstResult = RmGetList(session, out needed, ref count, null, out reason);',
  '      if (firstResult != 0 && firstResult != 234) throw new InvalidOperationException("RmGetList failed");',
  '      if (firstResult == 234 && needed == 0) throw new InvalidOperationException("RmGetList incomplete");',
  '      if (needed > 0) {',
  '        var info = new RM_PROCESS_INFO[needed]; count = needed;',
  '        if (RmGetList(session, out needed, ref count, info, out reason) != 0) throw new InvalidOperationException("RmGetList failed");',
  '        for (uint i = 0; i < count; i++) {',
  '          var process = info[i].Process;',
  '          ulong ticks = ((ulong)(uint)process.ProcessStartTime.dwHighDateTime << 32) | (uint)process.ProcessStartTime.dwLowDateTime;',
  '          holders.Add(new Holder { pid = process.dwProcessId, createTime100ns = ticks.ToString(System.Globalization.CultureInfo.InvariantCulture) });',
  '        }',
  '      }',
  '    } finally { RmEndSession(session); }',
  '    return holders.ToArray();',
  '  }',
  '}',
].join('\n');

module.exports = { RM_CSHARP };
