/**
 * @file platform/rm-csharp.js
 * @module main/platform/rm-csharp
 * @description The C# Windows Restart Manager (rstrtmgr.dll) P/Invoke wrapper
 *   source, compiled per spawn via Add-Type inside restart-manager.js. Extracted
 *   to its own module to keep restart-manager.js under the 300-line limit; the
 *   string is byte-for-byte the value restart-manager previously defined inline,
 *   so behavior is unchanged.
 *
 *   The wrapper exposes a single static GetHolders(string[] files) → int[] of
 *   holder PIDs. It uses the two-call RmGetList protocol and branches on
 *   pnProcInfoNeeded > 0 (the holder count) — NOT on a 234/ERROR_MORE_DATA
 *   return code, which does not arrive here.
 *
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.10.0
 */
'use strict';

/**
 * The C# Restart Manager wrapper compiled once per spawn via Add-Type. Exposes
 * a single static GetHolders(string[] files) → int[] of holder PIDs. Uses the
 * two-call RmGetList protocol and branches on pnProcInfoNeeded > 0 (the holder
 * count) — NOT on a 234/ERROR_MORE_DATA return code, which does not arrive here.
 * @type {string}
 */
const RM_CSHARP = [
  'using System;',
  'using System.Collections.Generic;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public static class AegisRm {',
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
  '  public static int[] GetHolders(string[] files) {',
  '    var pids = new List<int>();',
  '    if (files == null || files.Length == 0) return pids.ToArray();',
  '    uint session; var key = new StringBuilder(CCH_RM_SESSION_KEY + 1);',
  '    if (RmStartSession(out session, 0, key) != 0) return pids.ToArray();',
  '    try {',
  '      if (RmRegisterResources(session, (uint)files.Length, files, 0, IntPtr.Zero, 0, null) != 0) return pids.ToArray();',
  '      uint needed = 0, count = 0, reason = 0;',
  '      RmGetList(session, out needed, ref count, null, out reason);',
  '      if (needed > 0) {',
  '        var info = new RM_PROCESS_INFO[needed]; count = needed;',
  '        if (RmGetList(session, out needed, ref count, info, out reason) == 0) {',
  '          for (uint i = 0; i < count; i++) pids.Add(info[i].Process.dwProcessId);',
  '        }',
  '      }',
  '    } finally { RmEndSession(session); }',
  '    return pids.ToArray();',
  '  }',
  '}',
].join('\n');

module.exports = { RM_CSHARP };
