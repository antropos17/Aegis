"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path").win32;
const assert = require("node:assert/strict");
const source = fs.readFileSync(
  path.join(__dirname, "cloud-guest-task.cjs"),
  "utf8",
);
const trusted = "C:\\ProgramData\\AegisCloudLab\\trusted";
const root = "C:\\AegisLab";
function run(mode) {
  const host = [
    "D:\\aegis-cloud-guest-123-1\\canaries\\" + "a".repeat(32) + ".txt",
    "D:\\aegis-cloud-guest-123-1\\canaries\\" + "b".repeat(32) + ".txt",
  ];
  const files = new Map([
    [
      path.join(trusted, "manifest.json"),
      JSON.stringify({
        hostCanaries: mode === "wrong-path" ? ["X:/unexpected", host[1]] : host,
      }),
    ],
    [
      path.join(trusted, "network-endpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        nonce: "a".repeat(32),
        ports: { tcp4: 1, tcp6: 2, udp4: 3, udp6: 4 },
      }),
    ],
    [path.join(root, "input", "numbers.json"), '{"a":2,"b":3}'],
    [path.join(trusted, "route-endpoint.json"), JSON.stringify({ schemaVersion: 1, addresses: { ipv4: "10.0.0.1", ipv6: null },
      ports: { tcp4: 30001, udp4: 30002, dns4: 30003, tcp6: null, udp6: null, dns6: null },
      nonce: "b".repeat(32), sourceSha: "c".repeat(40), vmId: "a0000000-0000-0000-0000-000000000000" })],
    [
      path.join(root, "work", "sum.cjs"),
      mode === "wrong-work" ? "changed" : "module.exports=(a,b)=>a-b;\n",
    ],
  ]);
  const fail = (code) => {
    throw Object.assign(new Error("synthetic"), { code });
  };
  const doubles = {
    readFileSync(selected) {
      if (mode === "input-private-error" && selected.endsWith("numbers.json"))
        return fail("PRIVATE_SENTINEL");
      if (files.has(selected)) return files.get(selected);
      if (host.includes(selected)) return fail("ENOENT");
      return fail(mode === "protection-open" ? "ENOENT" : "EACCES");
    },
    writeFileSync(selected, text) {
      if (host.includes(selected)) return fail("ENOENT");
      files.set(selected, text);
    },
    appendFileSync() {
      fail("EACCES");
    },
    openSync() {
      fail("EACCES");
    },
    closeSync() {},
    unlinkSync() {
      fail("ENOENT");
    },
  };
  const spawnSync = (exe, args, options) => {
    if (args[0] === path.join(trusted, "route-client.cjs")) {
      assert.equal(options.timeout, 4500); assert.equal(options.maxBuffer, 8192);
      assert.equal(files.has(path.join(root, "work", "network-client-result.json")), true);
      assert.equal(files.get(path.join(root, "work", "sum.cjs")), mode === "wrong-work" ? "changed" : "module.exports=(a,b)=>a-b;\n");
      const value = { schemaVersion: 1, attemptsComplete: mode !== "route-partial", e3Qualified: false, launchAllowed: mode === "route-permission" };
      return { status: mode === "route-nonzero" ? 7 : 0, error: mode === "route-deadline" ? { code: "PRIVATE_SENTINEL" } : null,
        stdout: Buffer.from(mode === "route-malformed" ? "PRIVATE_SENTINEL" : JSON.stringify(value)),
        stderr: mode === "route-stderr" ? Buffer.from("PRIVATE_SENTINEL") : Buffer.alloc(0) };
    }
    if (args[0] === path.join(trusted, "client.cjs")) {
      assert.equal(options.timeout, 15000);
      assert.equal(options.maxBuffer, 8192);
      assert.equal(JSON.parse(options.input).nonce, "a".repeat(32));
      assert.equal(
        files.get(path.join(root, "work", "sum.cjs")),
        mode === "wrong-work" ? "changed" : "module.exports=(a,b)=>a-b;\n",
      );
      const value = {
        schemaVersion: 1,
        loopbackControlsComplete: mode !== "network-partial",
        labCorpusComplete: false,
        e3Qualified: false,
        launchAllowed: false,
      };
      return {
        status: mode === "network-nonzero" ? 7 : 0,
        error:
          mode === "network-deadline" ? { code: "PRIVATE_SENTINEL" } : null,
        stdout: Buffer.from(
          mode === "network-malformed"
            ? "PRIVATE_SENTINEL"
            : JSON.stringify(value),
        ),
        stderr:
          mode === "network-stderr"
            ? Buffer.from("PRIVATE_SENTINEL")
            : Buffer.alloc(0),
      };
    }
    if (args[0] === path.join(trusted, "cloud-guest-git.cjs")) {
      assert.equal(options.timeout, 3000); assert.equal(options.maxBuffer, 4096);
      assert.equal(files.has(path.join(root, "work", "route-client-result.json")), true);
      assert.equal(files.has(path.join(root, "scratch", "positive-child.txt")), true);
      assert.equal(files.get(path.join(root, "work", "sum.cjs")), "module.exports=(a,b)=>a+b;\n");
      const receipt = {passed:mode!=="git-partial",scope:"fixed-disposable-git",version:"2.56.0.windows.2",commands:13,elapsedMilliseconds:1000,launchAllowed:false};
      return {status:mode==="git-nonzero"?7:0,error:mode==="git-deadline"?{}:null,
        stdout:Buffer.from(mode==="git-malformed"?"PRIVATE_SENTINEL":JSON.stringify(receipt)),
        stderr:mode==="git-stderr"?Buffer.from("PRIVATE_SENTINEL"):Buffer.alloc(0)};
    }
    if (args[0] === "--test") {
      assert.equal(
        files.get(path.join(root, "work", "sum.cjs")),
        "module.exports=(a,b)=>a+b;\n",
      );
      return {
        status: mode === "unit-test-nonzero" ? 7 : 0,
        stdout: Buffer.from("test-control"),
      };
    }
    if (args[0] === "-e" && args.length === 2) {
      files.set(
        path.join(root, "scratch", "positive-child.txt"),
        "descendant-control",
      );
      return { status: 0 };
    }
    if (args[0] === "/d" && args[2].includes("positive.txt"))
      return {
        status: mode === "shell-control-fails" ? 1 : 0,
        stdout: Buffer.from(mode === "shell-marker-mismatch" ? "unapproved-marker" : "guest-scratch-control"),
      };
    return { status: args[0] === "-e" ? 0 : 1 };
  };
  const process = {
    platform: "win32",
    env: { AEGIS_CLOUD_GUEST_TASK: "1" },
    execPath: path.join(trusted, "node.exe"),
    exit() {
      throw new Error("guard");
    },
  };
  const requireDouble = (name) => {
    if (name === path.join(trusted, "protocol.cjs"))
      return require("./protocol.cjs");
    if (name === path.join(trusted, "route-protocol.cjs")) return { endpoints: value => require("./route-protocol.cjs").endpoints(JSON.parse(JSON.stringify(value))) };
    if (name === "node:perf_hooks") { let calls=0; return {performance:{now:()=>mode==="git-admission-late"&&calls++>0?9000:0}}; }
    if (name === "node:fs") return doubles;
    if (name === "node:path") return path;
    if (name === "node:child_process") return { spawnSync };
    if (name === path.join(root, "work", "sum.cjs")) {
      const module = { exports: null };
      vm.runInNewContext(files.get(name), { module });
      return module.exports;
    }
    throw new Error("unapproved-require");
  };
  vm.runInNewContext(
    source,
    { require: requireDouble, process, Buffer },
    { timeout: 1000 },
  );
  const result = JSON.parse(files.get(path.join(root, "work", "result.json")));
  return { result, process, files };
}
const positive = run("positive");
assert.equal(positive.process.exitCode, 0);
assert.equal(positive.result.passed, true);
assert.equal(positive.result.networkControlsComplete, true);
assert.equal(positive.result.readEditTestPassed, true);
assert.equal(positive.result.shellAndDescendantPositive, true);
assert.equal(positive.result.protectedProbes.length, 4);
assert.equal(positive.result.hostPathProbes.length, 14);
assert.equal(
  positive.files
    .get(path.join(root, "work", "sum.cjs"))
    .charCodeAt(
      positive.files.get(path.join(root, "work", "sum.cjs")).length - 1,
    ),
  10,
);
for (const mode of [
  "git-partial",
  "git-nonzero",
  "git-deadline",
  "git-malformed",
  "git-stderr",
  "git-admission-late",
  "wrong-path",
  "wrong-work",
  "protection-open",
  "shell-control-fails",
  "shell-marker-mismatch",
  "unit-test-nonzero",
  "input-private-error",
  "network-nonzero",
  "network-deadline",
  "network-malformed",
  "network-partial",
  "network-stderr",
]) {
  const refused = run(mode);
  assert.equal(refused.result.passed, false, mode);
  assert.equal(refused.process.exitCode, 1, mode);
  if (mode === "shell-control-fails" || mode === "shell-marker-mismatch") {
    assert.equal(refused.result.stage, "shell-descendant");
    assert.equal(refused.result.failure.childExitCode, mode === "shell-control-fails" ? 1 : 0);
    assert.equal(refused.files.has(path.join(root, "scratch", "positive-child.txt")), false);
  }
  if (mode.startsWith("git-")) {
      assert.equal(refused.result.stage, "git");
      assert.equal(refused.result.readEditTestPassed, true);
      assert.equal(JSON.stringify(refused.result).includes("PRIVATE_SENTINEL"), false);
    }
    if (mode.startsWith("network-")) {
    assert.equal(refused.result.stage, "network");
    assert.equal(refused.result.networkControlsComplete, false);
    assert.equal(refused.result.readEditTestPassed, false);
    assert.equal(
      refused.result.failure.childExitCode,
      mode === "network-nonzero" ? 7 : 0,
    );
    assert.equal(
      JSON.stringify(refused.result).includes("PRIVATE_SENTINEL"),
      false,
    );
  }
  if (mode === "unit-test-nonzero") {
    assert.equal(refused.result.stage, "unit-test");
    assert.deepEqual(refused.result.failure, {
      stage: "unit-test",
      childExitCode: 7,
    });
  }
  if (mode === "input-private-error") {
    assert.equal(refused.result.stage, "input");
    assert.deepEqual(refused.result.failure, {
      stage: "input",
      childExitCode: null,
    });
    assert.equal(
      JSON.stringify(refused.result).includes("PRIVATE_SENTINEL"),
      false,
    );
  }
}
for (const mode of ["route-partial", "route-nonzero", "route-deadline", "route-malformed", "route-stderr", "route-permission"]) {
  const refused = run(mode);
  assert.equal(refused.result.passed, false); assert.equal(refused.process.exitCode, 1);
  assert.equal(refused.result.stage, "direct-routes"); assert.equal(refused.result.readEditTestPassed, false);
  assert.equal(refused.result.networkControlsComplete, true);
  assert.equal(refused.files.has(path.join(root, "work", "git-result.json")), false);
  assert.equal(JSON.stringify(refused.result).includes("PRIVATE_SENTINEL"), false);
}

console.log(
  JSON.stringify({
    cases: 25,
    passed: 25,
    scope: "synthetic-task-source-behavior-no-guest-or-VM-effects",
  }),
);
