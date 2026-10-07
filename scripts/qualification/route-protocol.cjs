"use strict";
const net = require("node:net");
const FAMILIES = [4, 6];
const KINDS = ["tcp", "udp", "dns"];
function refuse() { throw new Error("fixed-route-contract-refused"); }
function fields(value, expected) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(",") !== expected) refuse();
}
function config(value, localControl = false) {
  fields(value, "addresses,nonce,sourceSha,vmId");
  if (!/^[a-f0-9]{32}$/.test(value.nonce) || !/^[a-f0-9]{40}$/.test(value.sourceSha) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.vmId)) refuse();
  fields(value.addresses, "ipv4,ipv6");
  for (const family of FAMILIES) {
    const address = value.addresses[`ipv${family}`];
    if (family === 6 && address === null) continue;
    if (typeof address !== "string" || net.isIP(address) !== family || address.includes("%")) refuse();
    const loop = address.startsWith("127.") || address === "::1";
    if (localControl ? !loop : loop || address === "0.0.0.0" || address === "::" || /^fe[89ab]/i.test(address)) refuse();
    if (!localControl && (family === 4 ? !/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(address) : !/^f[cd]/i.test(address))) refuse();
  }
  return value;
}
function endpoints(value, localControl = false) {
  fields(value, "addresses,nonce,ports,schemaVersion,sourceSha,vmId");
  if (value.schemaVersion !== 1) refuse();
  config({ addresses: value.addresses, nonce: value.nonce, sourceSha: value.sourceSha, vmId: value.vmId }, localControl);
  fields(value.ports, "dns4,dns6,tcp4,tcp6,udp4,udp6");
  for (const family of FAMILIES) for (const kind of KINDS) {
    const port = value.ports[kind + family];
    if (family === 6 && value.addresses.ipv6 === null) { if (port !== null) refuse(); }
    else if (!Number.isInteger(port) || port < 1024 || port > 65535) refuse();
  }
  return value;
}
function payload(endpoint, origin, kind, family) {
  if (!["positive", "guest"].includes(origin) || !KINDS.includes(kind) || !FAMILIES.includes(family)) refuse();
  return Buffer.from(`aegis-route:${endpoint.nonce}:${origin}:${kind}${family}\n`, "ascii");
}
function dnsName(endpoint, origin, family) {
  if (!["positive", "guest"].includes(origin) || !FAMILIES.includes(family)) refuse();
  return `${endpoint.nonce}.${origin}.dns${family}.aegis-control.invalid`;
}
function dnsQuestion(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 12 || packet.length > 256 ||
      packet.readUInt16BE(4) !== 1 || packet.readUInt16BE(6) !== 0 || packet.readUInt16BE(8) !== 0 ||
      packet.readUInt16BE(10) !== 0 || (packet.readUInt16BE(2) & 0xf800) !== 0) return null;
  const labels = []; let offset = 12;
  for (let i = 0; i < 8; i++) {
    const length = packet[offset++];
    if (length === 0) break;
    if (!length || length > 63 || offset + length > packet.length) return null;
    const label = packet.subarray(offset, offset + length).toString("ascii");
    if (!/^[a-z0-9-]+$/.test(label)) return null;
    labels.push(label); offset += length;
  }
  if (offset + 4 !== packet.length || packet[offset - 1] !== 0 || packet.readUInt16BE(offset + 2) !== 1 ||
      ![1, 28].includes(packet.readUInt16BE(offset))) return null;
  return { name: labels.join("."), type: packet.readUInt16BE(offset) };
}
function response(packet) {
  const answer = Buffer.from(packet); answer.writeUInt16BE(0x8183, 2); return answer;
}
function cases(endpoint) {
  return FAMILIES.flatMap(family => KINDS.map(kind => ({ id: kind + family, available: endpoint.addresses[`ipv${family}`] !== null })));
}
module.exports = { config, endpoints, payload, dnsName, dnsQuestion, response, cases, FAMILIES, KINDS };
