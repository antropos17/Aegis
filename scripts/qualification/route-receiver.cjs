"use strict";
const net = require("node:net"), dgram = require("node:dgram"), os = require("node:os");
const protocol = require("./route-protocol.cjs"), client = require("./route-client.cjs");
async function start(configuration, localControl = false) {
  protocol.config(configuration, localControl);
  if (!localControl) {
    const owned = Object.values(os.networkInterfaces()).flat().filter(Boolean).filter(entry => !entry.internal).map(entry => entry.address);
    for (const address of Object.values(configuration.addresses)) if (address !== null && !owned.includes(address)) throw new Error("host-route-address-not-owned");
  }
  const endpoint = { schemaVersion: 1, ...configuration, ports: { tcp4: null, udp4: null, dns4: null, tcp6: null, udp6: null, dns6: null } };
  const metrics = protocol.cases(endpoint).map(entry => ({ ...entry, positive: 0, guest: 0 }));
  const resources = [], connections = new Set(); let rejected = 0, bytes = 0, packets = 0, accepted = 0, positivePassed = false, expired = false, closed = false;
  const watch = process.hrtime.bigint();
  const milliseconds = () => Number((process.hrtime.bigint() - watch) / 1000000n);
  function accept(buffer, kind, family) {
    bytes = Math.min(4097, bytes + buffer.length); packets = Math.min(25, packets + 1);
    if (bytes > 4096 || packets > 24 || buffer.length > 256) {
      rejected = Math.min(25, rejected + 1);
      if (!closed) close(false).catch(() => {});
      return false;
    }
    const value = metrics.find(item => item.id === kind + family);
    let origin = null;
    for (const candidate of ["positive", "guest"]) {
      if (kind === "dns") {
        const question = protocol.dnsQuestion(buffer);
        if (question?.name === protocol.dnsName(endpoint, candidate, family) && question.type === (family === 4 ? 1 : 28)) origin = candidate;
      } else if (buffer.equals(protocol.payload(endpoint, candidate, kind, family))) origin = candidate;
    }
    if (origin === null || value[origin] !== 0) { rejected = Math.min(25, rejected + 1); return false; }
    value[origin]++; return true;
  }
  async function close(requested = true, shutdownReason = requested ? "stop" : "receiver-refused") {
    if (!["stop", "receiver-refused", "owner-eof", "invalid-control", "deadline"].includes(shutdownReason) ||
        requested !== (shutdownReason === "stop") || expired !== (shutdownReason === "deadline"))
      throw new Error("host-route-reason-refused");
    if (closed) throw new Error("host-route-already-closed"); closed = true;
    const stopMilliseconds = milliseconds();
    // Continue receiving briefly after the actual guest Job closure supplied by
    // the caller, then close every socket and independently wait for callbacks.
    await new Promise(resolve => setTimeout(resolve, 200));
    for (const connection of connections) connection.destroy();
    await Promise.all(resources.map(resource => new Promise(resolve => {
      try { resource.close(resolve); } catch { rejected++; resolve(); }
    })));
    return { schemaVersion: 1, scope: "independent-host-route-receiver", nonce: endpoint.nonce, sourceSha: endpoint.sourceSha,
      vmId: endpoint.vmId, addresses: endpoint.addresses, ports: endpoint.ports, positivePassed,
      cases: metrics, rejected, bytes, packets, accepted, openConnections: connections.size,
      socketsClosed: true, stoppedOnRequest: requested, expired, shutdownReason, stopMilliseconds, closedMilliseconds: milliseconds(),
      e3Qualified: false, launchAllowed: false, deliberateGuestExposureControl: false };
  }
  try {
    for (const family of protocol.FAMILIES) {
      const address = endpoint.addresses[`ipv${family}`]; if (address === null) continue;
      const server = net.createServer(connection => {
        accepted = Math.min(9, accepted + 1); connections.add(connection);
        if (accepted > 8) {
          rejected = Math.min(25, rejected + 1); connections.delete(connection); connection.destroy();
          if (!closed) close(false).catch(() => {}); return;
        }
        connection.setTimeout(800, () => connection.destroy()); let parts = [], length = 0;
        connection.on("data", part => { length += part.length; if (length > 256) { rejected++; connection.destroy(); } else parts.push(part); });
        connection.on("end", () => { accept(Buffer.concat(parts), "tcp", family); connection.end(); });
        connection.on("error", () => { rejected++; });
        connection.on("close", () => connections.delete(connection));
      });
      resources.push(server);
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: address, port: 0, ipv6Only: family === 6 }, resolve); });
      server.on("error", () => { rejected = Math.min(25, rejected + 1); });
      endpoint.ports[`tcp${family}`] = server.address().port;
      for (const kind of ["udp", "dns"]) {
        const socket = dgram.createSocket(family === 4 ? "udp4" : "udp6"); resources.push(socket);
        socket.on("message", (buffer, peer) => {
          const acceptedPacket = accept(buffer, kind, family);
          if (kind === "dns" && acceptedPacket) socket.send(protocol.response(buffer), peer.port, peer.address, error => { if (error) rejected = Math.min(25, rejected + 1); });
        });
        await new Promise((resolve, reject) => { socket.once("error", reject); socket.bind({ address, port: 0, ipv6Only: family === 6 }, resolve); });
        socket.on("error", () => { rejected++; }); endpoint.ports[kind + family] = socket.address().port;
      }
    }
    protocol.endpoints(endpoint, localControl);
    const positives = await client.run(endpoint, "positive");
    await new Promise(resolve => setTimeout(resolve, 100));
    positivePassed = positives.cases.every(item => !item.available || metrics.find(value => value.id === item.id).positive === 1) && rejected === 0;
    if (!positivePassed) throw new Error("host-route-positive-unconfirmed");
    return { endpoint, close,
      expire: async () => { expired = true; return close(false, "deadline"); },
      refuse: async reason => {
        if (reason !== "owner-eof" && reason !== "invalid-control") throw new Error("host-route-reason-refused");
        return close(false, reason);
      } };
  } catch (error) { try { await close(false); } catch { /* The existing bounded refusal/cleanup path owns this failure. */ } throw error; }
}
async function main() {
  if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" ||
      process.env.RUNNER_ENVIRONMENT !== "github-hosted" || process.env.RUNNER_OS !== "Windows") process.exit(2);
  let text = "";
  const configuration = await new Promise((resolve, reject) => {
    const receive = chunk => {
      text += chunk; if (Buffer.byteLength(text) > 2048) return reject(new Error("host-route-input-refused"));
      const newline = text.indexOf("\n"); if (newline >= 0) {
        process.stdin.removeListener("data", receive);
        const first = text.slice(0, newline); text = text.slice(newline + 1);
        try { resolve(JSON.parse(first)); } catch (error) { reject(error); }
      }
    };
    process.stdin.on("data", receive);
    process.stdin.once("end", () => reject(new Error("host-route-owner-lost")));
  });
  const receiver = await start(configuration);
  process.stdout.write(JSON.stringify(receiver.endpoint) + "\n");
  let finished = false;
  const finish = async (valid, reason) => {
    if (finished) return; finished = true; clearTimeout(timer);
    const receipt = valid ? await receiver.close(true) :
      reason === "deadline" ? await receiver.expire() : await receiver.refuse(reason);
    process.stdout.write(JSON.stringify(receipt) + "\n"); process.stdin.destroy(); if (!valid) process.exitCode = 2;
  };
  const timer = setTimeout(() => finish(false, "deadline").catch(() => { process.exitCode = 2; }), 120000);
  process.stdin.on("data", chunk => { text += chunk; if (text === "stop\n") finish(true, "stop").catch(() => { process.exitCode = 2; }); else if (text.length >= 5) finish(false, "invalid-control").catch(() => { process.exitCode = 2; }); });
  process.stdin.on("end", () => finish(false, "owner-eof").catch(() => { process.exitCode = 2; }));
}
if (require.main === module) main().catch(() => { process.exitCode = 2; });
module.exports = { start };
