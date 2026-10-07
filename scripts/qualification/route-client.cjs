"use strict";
const net = require("node:net"), dgram = require("node:dgram"), dns = require("node:dns");
const protocol = require("./route-protocol.cjs");
function code(error) {
  return ["EACCES", "EPERM", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EADDRNOTAVAIL", "ENOTFOUND", "ETIMEOUT", "ECANCELLED", "ENODATA", "EAI_AGAIN", "EAFNOSUPPORT", "EPROTONOSUPPORT", "ENOSYS"].includes(error?.code) ? error.code : "UNKNOWN";
}
async function attempt(endpoint, origin, kind, family) {
  const host = endpoint.addresses[`ipv${family}`], port = endpoint.ports[kind + family];
  if (host === null) return { id: kind + family, available: false, outcome: "address-unavailable", code: null };
  return new Promise(resolve => {
    let resource, done = false;
    const finish = (outcome, failure = null) => {
      if (done) return; done = true; clearTimeout(timer);
      if (resource && kind === "tcp") resource.destroy();
      else if (resource && kind === "udp") { try { resource.close(); } catch { /* The existing bounded refusal/cleanup path owns this failure. */ } }
      else if (resource) resource.cancel();
      resolve({ id: kind + family, available: true, outcome, code: failure });
    };
    const timer = setTimeout(() => finish("deadline", "ETIMEDOUT"), 650);
    const failed = error => {
      const failure = code(error);
      finish(["EAFNOSUPPORT", "EPROTONOSUPPORT", "ENOSYS"].includes(failure) ? "api-unavailable" : "api-error", failure);
    };
    try {
    if (kind === "tcp") {
      resource = net.createConnection({ host, port, family });
      resource.on("error", failed);
      resource.on("connect", () => resource.end(protocol.payload(endpoint, origin, kind, family)));
      resource.on("close", hadError => { if (!hadError) finish("connected-and-closed"); });
    } else if (kind === "udp") {
      resource = dgram.createSocket(family === 4 ? "udp4" : "udp6");
      resource.on("error", failed);
      resource.send(protocol.payload(endpoint, origin, kind, family), port, host, error => error ? failed(error) : finish("submitted"));
    } else {
      resource = new dns.Resolver({ timeout: 300, tries: 1 });
      try {
        resource.setServers([family === 4 ? `${host}:${port}` : `[${host}]:${port}`]);
        resource[family === 4 ? "resolve4" : "resolve6"](protocol.dnsName(endpoint, origin, family), error => finish("resolver-completed", error ? code(error) : null));
      } catch (error) { failed(error); }
    }
    } catch (error) { failed(error); }
  });
}
async function run(endpoint, origin = "guest") {
  const results = [];
  for (const family of protocol.FAMILIES) for (const kind of protocol.KINDS) results.push(await attempt(endpoint, origin, kind, family));
  return { schemaVersion: 1, scope: "fixed-host-route-attempts", nonce: endpoint.nonce, sourceSha: endpoint.sourceSha,
    vmId: endpoint.vmId, attemptsComplete: true, cases: results, e3Qualified: false, launchAllowed: false };
}
async function main() {
  if (process.platform !== "win32" || process.env.AEGIS_CLOUD_GUEST_TASK !== "1") process.exit(2);
  let text = "";
  for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 2048) throw new Error("fixed-route-input-refused"); }
  const result = await run(protocol.endpoints(JSON.parse(text)));
  process.stdout.write(JSON.stringify(result) + "\n");
}
if (require.main === module) main().catch(() => { process.exitCode = 2; });
module.exports = { run, attempt };
