import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '../..');
const phase = process.env.AEGIS_DPI_TEST_PHASE;
const evidence =
  process.env.AEGIS_DPI_NATIVE_OUTPUT ?? path.join(os.tmpdir(), 'aegis-etw-dpi-managed');
const selected = phase === 'red' || phase === 'green' ? phase : 'fixture';
const output = path.join(evidence, selected + '-' + crypto.randomUUID());
const compiler = path.join(
  process.env.WINDIR ?? 'C:/Windows',
  'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
);
const available = process.platform === 'win32' && fs.existsSync(compiler);
const fixture = path.join(root, 'tests/fixtures/etw-read-process.cs');
const executable = path.join(output, 'managed-dpi-tests.exe');
const harness = path.join(output, 'ManagedDpiTests.cs');
const env = { ...process.env, TEMP: path.join(output, 'temp'), TMP: path.join(output, 'temp') };
const source = `using System;
using System.IO;
internal static class ManagedDpiTests {
  static void Check(bool value,string code) { if(!value)throw new Exception(code); }
  static EtwReadProcess.WindowOwner Owned(long handle) { Check(handle==123,"handle");return new EtwReadProcess.WindowOwner(7,71); }
  static EtwReadProcess.DpiMetadata Query(string text,Func<long,bool> exists,Func<long,EtwReadProcess.WindowOwner> owner,Func<long,uint> read) {
    EtwReadProcess.DpiMetadata result;
    Check(EtwReadProcess.TryWindowDpi(text,exists,owner,read,out result),"accepted-metadata-request");
    return result;
  }
  static void Wire() {
    int calls=0;
    var value=Query("window-dpi 71 123",h=>{Check(h==123,"handle");calls++;return true;},h=>{calls++;return Owned(h);},h=>{Check(h==123,"handle");calls++;return 96;});
    Check(calls==5 && value.WindowExists && value.OwnerMatched && value.Dpi==96,"metadata-result");
    foreach(var text in new[]{"window-dpi 0 123","window-dpi 071 123","window-dpi 2147483648 123","window-dpi -1 123","window-dpi +71 123","window-dpi 71 0","window-dpi 71 0123","window-dpi 71 -1","window-dpi 71 +123","window-dpi 71 9223372036854775808","window-dpi 71 123 "," window-dpi 71 123","window-dpi  71 123","window-dpi\\t71 123","window-dpi 71 123\\n","other 71 123"}) {
      EtwReadProcess.DpiMetadata refused;
      Check(!EtwReadProcess.TryWindowDpi(text,h=>{throw new Exception("unexpected-native-call");},h=>{throw new Exception("unexpected-native-call");},h=>{throw new Exception("unexpected-native-call");},out refused) && refused==null,"canonical-command-refusal");
    }
    Console.WriteLine(value.ToJson());
  }
  static void Before() {
    foreach(var owner in new[]{new EtwReadProcess.WindowOwner(0,71),new EtwReadProcess.WindowOwner(7,72)}) {
      var value=Query("window-dpi 71 123",h=>true,h=>owner,h=>{throw new Exception("unexpected-dpi-query");});
      Check(value.WindowExists && !value.OwnerMatched && value.Dpi==0,"before-owner-refusal");
    }
    var missing=Query("window-dpi 71 123",h=>false,h=>{throw new Exception("unexpected-owner-query");},h=>{throw new Exception("unexpected-dpi-query");});
    Check(!missing.WindowExists && !missing.OwnerMatched && missing.Dpi==0,"before-window-refusal");
    Console.WriteLine("PASS");
  }
  static void After() {
    foreach(var changed in new[]{new EtwReadProcess.WindowOwner(0,71),new EtwReadProcess.WindowOwner(7,72)}) {
      int calls=0;
      var value=Query("window-dpi 71 123",h=>true,h=>++calls==1?Owned(h):changed,h=>96);
      Check(calls==2 && value.WindowExists && !value.OwnerMatched && value.Dpi==0,"after-owner-refusal");
    }
    int samples=0;
    var missing=Query("window-dpi 71 123",h=>++samples==1,Owned,h=>96);
    Check(samples==2 && !missing.WindowExists && !missing.OwnerMatched && missing.Dpi==0,"after-window-refusal");
    Console.WriteLine("PASS");
  }
  static void Preload() {
    int calls=0;
    EtwReadProcess.PreloadWindowDpi((name,flags)=>{Check(name=="user32.dll" && flags==0x800,"system-only-preload");calls++;return new IntPtr(1);});
    Check(calls==1,"single-preload");
    bool refused=false;
    try { EtwReadProcess.PreloadWindowDpi((name,flags)=>IntPtr.Zero); } catch(IOException) { refused=true; }
    Check(refused,"preload-refusal");Console.WriteLine("PASS");
  }
  public static int Main(string[] args) {
    try {
      if(args.Length!=1)throw new Exception("fixture-mode");
      switch(args[0]) { case "wire":Wire();break;case "before":Before();break;case "after":After();break;case "preload":Preload();break;default:throw new Exception("fixture-mode"); }
      return 0;
    } catch(Exception error) { Console.Error.WriteLine("FAIL:"+error.Message);return 1; }
  }
}`;

function compileManagedFixture() {
  fs.mkdirSync(env.TEMP, { recursive: true });
  fs.writeFileSync(harness, source);
  const args = [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/langversion:5',
    '/warnaserror+',
    '/main:ManagedDpiTests',
    '/out:' + executable,
    fixture,
    harness,
  ];
  const startedAt = new Date().toISOString();
  const stdout = execFileSync(compiler, args, {
    env,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 4096,
    encoding: 'utf8',
  });
  fs.writeFileSync(
    path.join(output, 'compile.json'),
    JSON.stringify(
      {
        compiler,
        args,
        startedAt,
        completedAt: new Date().toISOString(),
        exitCode: 0,
        stdout,
        fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'),
        harnessSha256: crypto.createHash('sha256').update(source).digest('hex'),
        nativeCalls: false,
      },
      null,
      2,
    ),
  );
}

function check(mode) {
  const result = spawnSync(executable, [mode], {
    env,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 4096,
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

describe.skipIf(!available)('actual read fixture DPI metadata with managed-only delegates', () => {
  beforeAll(compileManagedFixture);
  it('accepts exact canonical metadata requests without read-proof fields', () => {
    expect(JSON.parse(check('wire'))).toEqual({
      command: 'window-dpi',
      schema: 'aegis-window-dpi/1',
      windowExists: true,
      ownerMatched: true,
      dpi: 96,
    });
  });
  it('refuses missing windows, foreign owners and zero owner threads before measuring DPI', () => {
    expect(check('before')).toBe('PASS');
  });
  it('discards measured DPI when the window disappears or its owner changes afterward', () => {
    expect(check('after')).toBe('PASS');
  });
  it('preloads only system User32 and refuses an unavailable module without window probes', () => {
    expect(check('preload')).toBe('PASS');
  });
});
