"use strict";
const assert = require("node:assert/strict");
const protocol = require("./route-protocol.cjs");
function evaluate(value, localControl = false) {
  const refused = { schemaVersion: 1, passed: false, status: "host-route-evidence-refused", e3Qualified: false, launchAllowed: false,
    deliberateGuestExposureControl: false, ipv6Coverage: "unavailable", cases: [] };
  try {
    assert.equal(Object.keys(value).sort().join(","), "after,before,client,endpoint,identity,owner,receiver,taskPassed");
    const endpoint = protocol.endpoints(value.endpoint, localControl), { receiver, client, identity, owner } = value;
    assert.equal(Object.keys(receiver).sort().join(","), "accepted,addresses,bytes,cases,closedMilliseconds,deliberateGuestExposureControl,e3Qualified,expired,launchAllowed,nonce,openConnections,packets,ports,positivePassed,rejected,schemaVersion,scope,shutdownReason,socketsClosed,sourceSha,stopMilliseconds,stoppedOnRequest,vmId");
    assert.equal(Object.keys(client).sort().join(","), "attemptsComplete,cases,e3Qualified,launchAllowed,nonce,schemaVersion,scope,sourceSha,vmId");
    for (const evidence of [receiver, client]) {
      assert.equal(evidence.schemaVersion, 1); assert.equal(evidence.nonce, endpoint.nonce);
      assert.equal(evidence.sourceSha, endpoint.sourceSha); assert.equal(evidence.vmId, endpoint.vmId);
      assert.equal(evidence.e3Qualified, false); assert.equal(evidence.launchAllowed, false);
    }
    assert.equal(receiver.scope, "independent-host-route-receiver"); assert.equal(client.scope, "fixed-host-route-attempts");
    assert.deepEqual(receiver.addresses, endpoint.addresses); assert.deepEqual(receiver.ports, endpoint.ports);
    for (const field of ["positivePassed", "socketsClosed", "stoppedOnRequest"]) assert.equal(receiver[field], true);
    for (const field of ["expired", "deliberateGuestExposureControl"]) assert.equal(receiver[field], false);
    assert.equal(receiver.shutdownReason, "stop");
    for (const field of ["rejected", "openConnections"]) assert.equal(receiver[field], 0);
    for (const field of ["bytes", "packets", "accepted", "stopMilliseconds", "closedMilliseconds"]) assert.ok(Number.isSafeInteger(receiver[field]) && receiver[field] >= 0);
    assert.ok(receiver.bytes <= 4096 && receiver.packets <= 24 && receiver.accepted <= 8);
    assert.ok(receiver.stopMilliseconds < 110000 && receiver.closedMilliseconds >= receiver.stopMilliseconds && receiver.closedMilliseconds < 115000);
    assert.equal(client.attemptsComplete, true); assert.equal(value.taskPassed, true);
    for (const field of ["heldIdentityBeforeRelease", "runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "runtimeResumed", "taskReleased", "jobClosureConfirmed", "exitCodeObserved", "passed"]) assert.equal(identity[field], true);
    assert.equal(identity.elevated, false); assert.equal(identity.administratorEnabled, false); assert.equal(identity.exitCode, 0);
    assert.ok(Number.isSafeInteger(identity.pid) && identity.pid > 0);
    assert.ok(typeof identity.birthFileTime === "string" && /^[1-9][0-9]{16,18}$/.test(identity.birthFileTime));
    assert.ok(/^S-1-5-21-(\d+-){3}\d+$/.test(identity.sid));
    for (const field of ["heldProcess", "birthObserved", "imagePinned", "exitObserved", "closed", "stopAfterJobClosure"]) assert.equal(owner[field], true);
    assert.equal(owner.forced, false); assert.equal(owner.exitCode, 0);
    assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
    assert.ok(typeof owner.birthTicks === "string" && /^[1-9][0-9]{16,18}$/.test(owner.birthTicks));
    assert.ok(typeof owner.imageSha256 === "string" && /^[a-f0-9]{64}$/.test(owner.imageSha256));
    assert.ok(owner.stopMilliseconds < 110000 && owner.exitMilliseconds >= owner.stopMilliseconds && owner.exitMilliseconds < 115000);
    for (const snapshot of [value.before, value.after]) {
      assert.equal(Object.keys(snapshot).sort().join(","), "name,nics,runAttempt,runId,state,vmId,vmRoot");
      assert.equal(snapshot.vmId, endpoint.vmId); assert.equal(snapshot.nics, 0); assert.equal(snapshot.state, "Running");
      assert.ok(typeof snapshot.runId === "string" && /^[0-9]+$/.test(snapshot.runId));
      assert.ok(typeof snapshot.runAttempt === "string" && /^[0-9]+$/.test(snapshot.runAttempt));
      assert.ok(new RegExp(`^aegis-cloud-${snapshot.runId}-${snapshot.runAttempt}-[a-f0-9]{32}$`).test(snapshot.name));
      assert.equal(snapshot.vmRoot, `D:\\aegis-cloud-guest-${snapshot.runId}-${snapshot.runAttempt}\\vm`);
    }
    assert.deepEqual(value.before, value.after);
    const expected = protocol.cases(endpoint); assert.equal(client.cases.length, 6); assert.equal(receiver.cases.length, 6);
    assert.equal(receiver.accepted, endpoint.addresses.ipv6 === null ? 1 : 2);
    assert.equal(receiver.packets, endpoint.addresses.ipv6 === null ? 3 : 6);
    const outcomes = ["connected-and-closed", "submitted", "resolver-completed", "api-error", "deadline"];
    const codes = [null, "EACCES", "EPERM", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EADDRNOTAVAIL", "ENOTFOUND", "ETIMEOUT", "ECANCELLED", "ENODATA", "EAI_AGAIN"];
    for (let index = 0; index < 6; index++) {
      const route = expected[index], observed = receiver.cases[index], attempt = client.cases[index];
      assert.equal(Object.keys(observed).sort().join(","), "available,guest,id,positive");
      assert.equal(Object.keys(attempt).sort().join(","), "available,code,id,outcome");
      assert.equal(observed.id, route.id); assert.equal(attempt.id, route.id);
      assert.equal(observed.available, route.available); assert.equal(attempt.available, route.available);
      assert.equal(observed.positive, route.available ? 1 : 0); assert.equal(observed.guest, 0);
      assert.ok(codes.includes(attempt.code));
      if (route.available) assert.ok(outcomes.includes(attempt.outcome));
      else { assert.equal(attempt.outcome, "address-unavailable"); assert.equal(attempt.code, null); }
    }
    return { ...refused, passed: true, status: "tested-host-routes-no-delivery-observed", fromHostPositives: true,
      ipv6Coverage: endpoint.addresses.ipv6 === null ? "unavailable" : "observed", cases: receiver.cases };
  } catch { return refused; }
}
async function main() {
  if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted") process.exit(2);
  let text = ""; for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 65536) throw new Error("host-route-oracle-input-refused"); }
  const result = evaluate(JSON.parse(text)); process.stdout.write(JSON.stringify(result) + "\n"); if (!result.passed) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { process.exitCode = 2; });
module.exports = { evaluate };
