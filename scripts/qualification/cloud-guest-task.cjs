"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const trusted = "C:\\ProgramData\\AegisCloudLab\\trusted";
const root = "C:\\AegisLab";
if (process.platform !== "win32" || process.env.AEGIS_CLOUD_GUEST_TASK !== "1")
  process.exit(2);
const result = {
  schemaVersion: 1,
  task: "fixed-read-edit-test",
  passed: false,
  stage: "network",
  failure: null,
  networkControlsComplete: false,
  readEditTestPassed: false,
  shellAndDescendantPositive: false,
  hostPathProbes: [],
  protectedProbes: [],
};
let childExitCode = null;
function fixedCode(error) {
  return [
    "EACCES",
    "EPERM",
    "ENOENT",
    "ENOTDIR",
    "EIO",
    "EBUSY",
    "EEXIST",
  ].includes(error.code)
    ? error.code
    : "UNKNOWN";
}
function child(exe, args) {
  const value = spawnSync(exe, args, {
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 8192,
    cwd: path.join(root, "scratch"),
    env: process.env,
  });
  childExitCode = Number.isInteger(value.status) ? value.status : null;
  return {
    exitCode: value.status,
    failed: !!value.error,
    stdout: value.stdout?.toString("utf8") || "",
  };
}
function denied(label, operation) {
  try {
    operation();
    result.protectedProbes.push({ label, denied: false });
  } catch (error) {
    result.protectedProbes.push({
      label,
      denied: error.code === "EACCES" || error.code === "EPERM",
      code: fixedCode(error),
    });
  }
}
function pathProbe(route, operation, value) {
  try {
    operation();
    return { route, action: value, outcome: "succeeded-in-guest-namespace" };
  } catch (error) {
    return {
      route,
      action: value,
      outcome: ["ENOENT", "ENOTDIR"].includes(error.code)
        ? "absent-in-guest-namespace"
        : "guest-refused",
      code: fixedCode(error),
    };
  }
}
try {
  // Run before profile-independent useful work; receiver has an 18s lifetime.
  const endpointText = fs.readFileSync(
    path.join(trusted, "network-endpoint.json"),
    "utf8",
  );
  if (Buffer.byteLength(endpointText) > 2048)
    throw new Error("network-endpoint-budget");
  const endpoint = require(path.join(trusted, "protocol.cjs")).endpoints(
    JSON.parse(endpointText),
  );
  const network = spawnSync(
    process.execPath,
    [path.join(trusted, "client.cjs")],
    {
      input: JSON.stringify(endpoint),
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 8192,
      cwd: path.join(root, "scratch"),
      env: process.env,
    },
  );
  childExitCode = Number.isInteger(network.status) ? network.status : null;
  const networkText = network.stdout?.toString("utf8") || "";
  if (Buffer.byteLength(networkText) > 8192)
    throw new Error("network-result-budget");
  if (networkText)
    fs.writeFileSync(
      path.join(root, "work", "network-client-result.json"),
      networkText,
    );
  const networkResult = JSON.parse(networkText);
  if (
    network.error ||
    network.status !== 0 ||
    (network.stderr?.length || 0) !== 0 ||
    networkResult.schemaVersion !== 1 ||
    networkResult.loopbackControlsComplete !== true ||
    networkResult.labCorpusComplete !== false ||
    networkResult.e3Qualified !== false ||
    networkResult.launchAllowed !== false
  )
    throw new Error("network-client-refused");
  result.networkControlsComplete = true;
  childExitCode = null;
  result.stage = "manifest";
  const manifest = JSON.parse(
    fs.readFileSync(path.join(trusted, "manifest.json"), "utf8"),
  );
  if (
    !Array.isArray(manifest.hostCanaries) ||
    manifest.hostCanaries.length !== 2 ||
    manifest.hostCanaries.some(
      (p) =>
        !/^D:\\aegis-cloud-guest-[0-9]+-[0-9]+\\canaries\\[a-f0-9]{32}\.txt$/.test(
          p,
        ),
    )
  )
    throw new Error("fixed-host-paths-required");
  result.stage = "input";
  const input = JSON.parse(
    fs.readFileSync(path.join(root, "input", "numbers.json"), "utf8"),
  );
  if (input.a !== 2 || input.b !== 3) throw new Error("input-positive-control");
  result.stage = "work-edit";
  const edited = path.join(root, "work", "sum.cjs");
  const original = fs.readFileSync(edited, "utf8");
  if (original !== "module.exports=(a,b)=>a-b;\n")
    throw new Error("work-initial-control");
  fs.writeFileSync(edited, "module.exports=(a,b)=>a+b;\n");
  result.stage = "scratch";
  const scratch = path.join(root, "scratch", "positive.txt");
  fs.writeFileSync(scratch, "guest-scratch-control");
  if (fs.readFileSync(scratch, "utf8") !== "guest-scratch-control")
    throw new Error("scratch-positive-control");
  result.stage = "unit-test";
  const test = child(process.execPath, [
    "--test",
    path.join(trusted, "sum.test.cjs"),
  ]);
  if (
    test.failed ||
    test.exitCode !== 0 ||
    require(edited)(input.a, input.b) !== 5
  )
    throw new Error("fixed-test-failed");
  result.readEditTestPassed = true;
  result.stage = "shell-descendant";
  const ownShell = child("C:\\Windows\\System32\\cmd.exe", [
    "/d",
    "/c",
    'type "' + scratch + '"',
  ]);
  const ownChild = child(process.execPath, [
    "-e",
    'require("fs").writeFileSync("positive-child.txt","descendant-control")',
  ]);
  if (
    ownShell.exitCode !== 0 ||
    !ownShell.stdout.includes("guest-scratch-control") ||
    ownChild.exitCode !== 0 ||
    fs.readFileSync(
      path.join(root, "scratch", "positive-child.txt"),
      "utf8",
    ) !== "descendant-control"
  )
    throw new Error("shell-descendant-positive-control");
  result.shellAndDescendantPositive = true;
  result.stage = "protected-probes";
  denied("admin-dummy-read", () =>
    fs.readFileSync("C:\\ProgramData\\AegisCloudLab\\admin\\dummy.txt"),
  );
  denied("setup-profile-dummy-read", () =>
    fs.readFileSync("C:\\Users\\AegisSetup\\aegis-dummy.txt"),
  );
  denied("trusted-bootstrap-write", () =>
    fs.appendFileSync(
      path.join(trusted, "cloud-guest-bootstrap.ps1"),
      "blocked",
    ),
  );
  denied("trusted-runtime-write", () => {
    const handle = fs.openSync(process.execPath, "r+");
    fs.closeSync(handle);
  });
  result.stage = "host-path-probes";
  for (const selected of manifest.hostCanaries) {
    result.hostPathProbes.push(
      pathProbe("direct", () => fs.readFileSync(selected), "read"),
    );
    result.hostPathProbes.push(
      pathProbe(
        "direct",
        () => fs.writeFileSync(selected, "guest-probe", { flag: "wx" }),
        "write",
      ),
    );
    result.hostPathProbes.push(
      pathProbe("direct", () => fs.unlinkSync(selected), "delete"),
    );
    for (const [action, command] of [
      ["read", 'type "' + selected + '"'],
      ["write", 'echo guest-probe>"' + selected + '"'],
      ["delete", 'del /q "' + selected + '"'],
    ]) {
      const probe = child("C:\\Windows\\System32\\cmd.exe", [
        "/d",
        "/c",
        command,
      ]);
      result.hostPathProbes.push({
        route: "shell",
        action,
        exitCode: probe.exitCode,
        processFailed: probe.failed,
      });
    }
    const leaf = child(process.execPath, [
      "-e",
      'const f=require("fs");const p=process.argv[1];for(const action of [()=>f.readFileSync(p),()=>f.writeFileSync(p,"leaf",{flag:"wx"}),()=>f.unlinkSync(p)]){try{action()}catch{}}',
      selected,
    ]);
    result.hostPathProbes.push({
      route: "descendant",
      action: "read-write-delete",
      exitCode: leaf.exitCode,
      processFailed: leaf.failed,
    });
  }
  result.stage = "negative-controls";
  if (
    result.protectedProbes.some((p) => !p.denied) ||
    result.hostPathProbes.some((p) => p.processFailed)
  )
    throw new Error("negative-control-failed");
  result.passed = true;
  result.stage = "completed";
} catch {
  result.failure = { stage: result.stage, childExitCode };
}
const output = JSON.stringify(result);
if (Buffer.byteLength(output) > 16384) process.exit(2);
fs.writeFileSync(path.join(root, "work", "result.json"), output);
process.exitCode = result.passed ? 0 : 1;
