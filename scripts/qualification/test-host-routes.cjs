"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), dgram = require("node:dgram");
const fs = require("node:fs"), path = require("node:path"), { spawn } = require("node:child_process");
const os = require("node:os");
const protocol = require("./route-protocol.cjs"), receiver = require("./route-receiver.cjs"), client = require("./route-client.cjs"), oracle = require("./route-oracle.cjs");
const configuration = { addresses: { ipv4: "127.0.0.1", ipv6: "::1" }, nonce: "a".repeat(32), sourceSha: "b".repeat(40), vmId: "a0000000-0000-0000-0000-000000000000" };
// Created by actual lab assignment AST -> actual adapter under PS5.1; do not
// fabricate the producer naming/path assumptions again in an oracle fixture.
const driverFixture = process.env.AEGIS_ROUTE_DRIVER_SNAPSHOT;
assert.equal(typeof driverFixture, "string", "run maintained test-host-routes.ps1 first");
assert.equal(fs.lstatSync(driverFixture).isSymbolicLink(), false);
assert.ok(fs.statSync(driverFixture).size <= 1024);
const driverSnapshot = JSON.parse(fs.readFileSync(driverFixture, "utf8"));
function evidence(endpoint, receipt) {
  const snapshot = JSON.parse(JSON.stringify(driverSnapshot)); assert.equal(snapshot.vmId, endpoint.vmId);
  return { endpoint, receiver: receipt,
    client: { schemaVersion: 1, scope: "fixed-host-route-attempts", nonce: endpoint.nonce, sourceSha: endpoint.sourceSha, vmId: endpoint.vmId, attemptsComplete: true,
      cases: protocol.cases(endpoint).map(item => ({ ...item, outcome: item.available ? "api-error" : "address-unavailable", code: item.available ? "ENETUNREACH" : null })), e3Qualified: false, launchAllowed: false },
    identity: { pid: 1234, birthFileTime: "134044679077711234", sid: "S-1-5-21-1-2-3-1001", heldIdentityBeforeRelease: true,
      runtimeCallerAuthenticated: true, runtimeInitializedBeforeProject: true, runtimeResumed: true, taskReleased: true,
      jobClosureConfirmed: true, exitCodeObserved: true, passed: true, elevated: false, administratorEnabled: false, exitCode: 0 },
    owner: { heldProcess: true, birthObserved: true, imagePinned: true, pid: 5678, birthTicks: "639115271077711234", imageSha256: "c".repeat(64),
      exitObserved: true, closed: true, stopAfterJobClosure: true, forced: false, exitCode: 0, stopMilliseconds: 2500, exitMilliseconds: 3000 },
    before: snapshot, after: { ...snapshot }, taskPassed: true };
}
test("production contracts refuse loopback, public, scoped and malformed targets", () => {
  for (const addresses of [configuration.addresses, { ipv4: "8.8.8.8", ipv6: null }, { ipv4: "10.0.0.1", ipv6: "fe80::1%1" }, { ipv4: "10.0.0.1", ipv6: "2001:db8::1" }])
    assert.throws(() => protocol.config({ ...configuration, addresses }));
  const allowed = { ...configuration, addresses: { ipv4: "10.0.0.1", ipv6: "fd00::1" } }; assert.equal(protocol.config(allowed), allowed);
  assert.throws(() => protocol.config({ ...allowed, extra: true }));
  assert.throws(() => protocol.config({ ...allowed, vmId: "foreign" }));
});
test("actual IPv4/IPv6 host positives are received and closed; identity in this control is synthetic", async () => {
  const running = await receiver.start(configuration, true), receipt = await running.close();
  assert.equal(receipt.positivePassed, true); assert.equal(receipt.socketsClosed, true); assert.equal(receipt.openConnections, 0);
  assert.deepEqual(receipt.cases.map(item => item.positive), [1, 1, 1, 1, 1, 1]);
  const model = evidence(running.endpoint, receipt); assert.equal(oracle.evaluate(model, true).passed, true);
  for (const field of ["runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "heldIdentityBeforeRelease", "jobClosureConfirmed", "exitCodeObserved", "passed"]) {
    const copy = JSON.parse(JSON.stringify(model)); copy.identity[field] = false; assert.equal(oracle.evaluate(copy, true).passed, false, field);
  }
  const mutations = [
    value => { value.receiver.cases[0].positive = 0; }, value => { value.receiver.cases[0].guest = 1; },
    value => { value.receiver.expired = true; }, value => { value.receiver.stoppedOnRequest = false; },
    value => { value.owner.forced = true; }, value => { value.owner.stopAfterJobClosure = false; },
    value => { value.owner.exitObserved = false; }, value => { value.owner.exitMilliseconds = 115000; },
    value => { value.receiver.closedMilliseconds = 115000; }, value => { value.before.nics = 1; },
    value => { value.after.vmId = "foreign"; }, value => { value.taskPassed = false; },
    value => { value.after.state = "Off"; },
    value => { value.after.name = "aegis-cloud-guest-123-1"; },
    value => { value.after.vmRoot = "D:\\" + value.after.name + "\\vm"; },
    value => { value.after.runId = "999"; },
    value => { value.client.cases[0].id = "other"; }, value => { value.client.cases[0].available = false; },
    value => { value.client.cases[0].code = "UNKNOWN"; },
    value => { value.client.cases[0].outcome = "api-unavailable"; value.client.cases[0].code = "EAFNOSUPPORT"; },
    value => { value.receiver.sourceSha = "c".repeat(40); }, value => { value.receiver.ports.tcp4++; },
    value => { value.client.nonce = "c".repeat(32); }, value => { value.receiver.openConnections = 1; },
  ];
  for (const mutate of mutations) { const copy = JSON.parse(JSON.stringify(model)); mutate(copy); assert.equal(oracle.evaluate(copy, true).passed, false); }
});
test("actual deliberate local guest exposure delivers all six and independent oracle refuses", async () => {
  const running = await receiver.start(configuration, true);
  const attempts = await client.run(running.endpoint, "guest"); const receipt = await running.close();
  assert.deepEqual(receipt.cases.map(item => item.guest), [1, 1, 1, 1, 1, 1]);
  const model = evidence(running.endpoint, receipt); model.client = attempts; assert.equal(oracle.evaluate(model, true).passed, false);
});
test("IPv6 absence remains three explicit unavailable cases", async () => {
  const running = await receiver.start({ ...configuration, addresses: { ipv4: "127.0.0.1", ipv6: null } }, true);
  const receipt = await running.close(); const outcome = oracle.evaluate(evidence(running.endpoint, receipt), true);
  assert.equal(outcome.passed, true); assert.equal(outcome.ipv6Coverage, "unavailable");
  assert.deepEqual(receipt.cases.slice(3).map(item => [item.available, item.positive, item.guest]), [[false, 0, 0], [false, 0, 0], [false, 0, 0]]);
});
test("unknown raw packets do not become guest zero-count acceptance", async () => {
  const running = await receiver.start(configuration, true), socket = dgram.createSocket("udp4");
  await new Promise((resolve, reject) => socket.send(Buffer.from("secret-model-must-not-publish"), running.endpoint.ports.udp4, "127.0.0.1", error => error ? reject(error) : resolve()));
  socket.close(); const receipt = await running.close(); assert.equal(receipt.rejected, 1);
  assert.equal(JSON.stringify(receipt).includes("secret-model"), false); assert.equal(oracle.evaluate(evidence(running.endpoint, receipt), true).passed, false);
});
test("nonrequested receiver closure is refused", async () => {
  const running = await receiver.start(configuration, true), receipt = await running.expire();
  assert.equal(receipt.expired, true); assert.equal(oracle.evaluate(evidence(running.endpoint, receipt), true).passed, false);
});
test("actual receiver stdio LF stop settles; CRLF/noncanonical stop refuses (test-only loopback source switch)", async () => {
  const original = fs.readFileSync(path.join(__dirname, "route-receiver.cjs"), "utf8");
  const marker = "const receiver = await start(configuration);";
  assert.equal(original.split(marker).length, 2);
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aegis-route-stdio-"));
  const fixture = path.join(temporary, "route-receiver-main-control.cjs");
  const source = original.replace(marker, "const receiver = await start(configuration, true);")
    .replace('require("./route-protocol.cjs")', `require(${JSON.stringify(path.join(__dirname, "route-protocol.cjs"))})`)
    .replace('require("./route-client.cjs")', `require(${JSON.stringify(path.join(__dirname, "route-client.cjs"))})`);
  fs.writeFileSync(fixture, source, { flag: "wx" });
  try {
  for (const terminator of ["stop\n", "stop\r\n"]) {
    const observation = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fixture], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
          GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Windows", NODE_DISABLE_COMPILE_CACHE: "1" } });
      let stdout = "", stderr = "", sent = false;
      const timer = setTimeout(() => { child.kill(); reject(new Error("stdio-control-deadline")); }, 3000);
      child.stdout.on("data", chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 4096) { child.kill(); reject(new Error("stdio-control-budget")); }
        if (!sent && stdout.includes("\n")) { sent = true; child.stdin.end(terminator); } });
      child.stderr.on("data", chunk => { stderr += chunk; if (Buffer.byteLength(stderr) > 128) child.kill(); });
      child.on("error", reject);
      child.on("close", exitCode => { clearTimeout(timer); resolve({ stdout, stderr, exitCode }); });
      child.stdin.write(JSON.stringify(configuration) + "\n");
    });
    assert.equal(observation.stderr, ""); const frames = observation.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(frames.length, 2); assert.equal(frames[1].socketsClosed, true);
    assert.equal(observation.exitCode, terminator === "stop\n" ? 0 : 2);
    assert.equal(frames[1].stoppedOnRequest, terminator === "stop\n");
  }
  } finally {
    assert.equal(fs.lstatSync(temporary).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(fixture).isSymbolicLink(), false);
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(temporary));
    fs.unlinkSync(fixture); fs.rmdirSync(temporary);
  }
});
