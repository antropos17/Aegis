import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import protocol from '../../../src/main/platform/sensor-protocol.js';

const directory = path.resolve('tests/fixtures/sensor-wire');
const cases = JSON.parse(fs.readFileSync(path.join(directory, 'cases.json'), 'utf8'));
const fixture = (name) => JSON.parse(cases.find((entry) => entry.name === name).json);
const S = 'sensor-to-host';
function rejects(message, direction = S, code = 'message-invalid') {
  for (const fn of [protocol.validateMessage, protocol.encodeFrame])
    expect(() => fn(message, { direction })).toThrowError(
      expect.objectContaining({ code, message: code }),
    );
}

describe('closed schemas, capabilities and privacy', () => {
  it.each([
    [
      'unknown message',
      'health',
      (v) => {
        v.t = 'unknown';
      },
    ],
    [
      'free-form health',
      'health',
      (v) => {
        v.detail = 'secret';
      },
    ],
    [
      'free-form error',
      'error',
      (v) => {
        v.code = 'secret';
      },
    ],
    [
      'mode reason',
      'mode-ebpf',
      (v) => {
        v.reason = 'secret';
      },
    ],
    [
      'loss reason',
      'loss-u64',
      (v) => {
        v.reason = 'secret';
      },
    ],
    [
      'platform/mode',
      'hello-ebpf',
      (v) => {
        v.platform = 'darwin';
      },
    ],
    [
      'announced platform',
      'hello-ebpf',
      (v) => {
        v.modes.push('libproc');
      },
    ],
    [
      'announced duplicate',
      'hello-ebpf',
      (v) => {
        v.modes.push('ebpf');
      },
    ],
    [
      'missing active mode',
      'hello-ebpf',
      (v) => {
        v.modes = ['procfs'];
      },
    ],
    [
      'no modes',
      'hello-ebpf',
      (v) => {
        v.modes = [];
      },
    ],
    [
      'wrong identity capability',
      'hello-ebpf',
      (v) => {
        v.caps.identity = 'procfs-ticks';
      },
    ],
    [
      'wrong witness capability',
      'hello-ebpf',
      (v) => {
        v.caps.witness = 'p-uniqueid';
      },
    ],
    [
      'nonboolean capability',
      'hello-ebpf',
      (v) => {
        v.caps.exec = 1;
      },
    ],
    [
      'libproc open claim',
      'hello-libproc',
      (v) => {
        v.caps.fileOpen = true;
      },
    ],
    [
      'clock kind',
      'hello-ebpf',
      (v) => {
        v.versions.clockAnchor.clock = 'mach-continuous';
      },
    ],
    [
      'clock raw number',
      'hello-ebpf',
      (v) => {
        v.versions.clockAnchor.unixUsec = 123;
      },
    ],
    [
      'unknown caps key',
      'hello-ebpf',
      (v) => {
        v.caps.argv = [];
      },
    ],
    [
      'unknown clock key',
      'hello-ebpf',
      (v) => {
        v.versions.clockAnchor.secret = 'x';
      },
    ],
    [
      'unknown version key',
      'hello-ebpf',
      (v) => {
        v.versions.kernelVersion = 'x';
      },
    ],
    [
      'unknown row key',
      'snapshot-linux',
      (v) => {
        v.procs[0].environment = {};
      },
    ],
    [
      'unknown witness key',
      'snapshot-linux',
      (v) => {
        v.procs[0].witness.secret = 'x';
      },
    ],
    [
      'event argv',
      'events-linux',
      (v) => {
        v.events[0].argv = ['private'];
      },
    ],
    [
      'event prompt',
      'events-linux',
      (v) => {
        v.events[0].prompt = 'private';
      },
    ],
    [
      'fork exit status',
      'events-linux',
      (v) => {
        v.events[3].status = 0;
      },
    ],
    [
      'birth mismatch',
      'events-linux',
      (v) => {
        v.events[0].birth = '12346';
      },
    ],
    [
      'contradictory null',
      'snapshot-linux',
      (v) => {
        v.procs[1].identityError = null;
      },
    ],
    [
      'mixed snapshot witnesses',
      'snapshot-linux',
      (v) => {
        v.procs[1] = fixture('snapshot-darwin').procs[0];
        v.procs[1].pid = 43;
      },
    ],
    [
      'mixed event witnesses',
      'events-linux',
      (v) => {
        Object.assign(v.events[1], fixture('snapshot-darwin').procs[0]);
        delete v.events[1].name;
      },
    ],
    [
      'duplicate snapshot PIDs',
      'snapshot-linux',
      (v) => {
        v.procs[1].pid = v.procs[0].pid;
      },
    ],
    [
      'bad access',
      'events-linux',
      (v) => {
        v.events[1].access = 'all';
      },
    ],
    [
      'IP family mismatch',
      'events-linux',
      (v) => {
        v.events[2].family = 6;
      },
    ],
    [
      'IP zone',
      'events-darwin',
      (v) => {
        v.events[2].saddr = 'fe80::1%eth0';
      },
    ],
    [
      'invalid IP',
      'events-linux',
      (v) => {
        v.events[2].daddr = '999.1.1.1';
      },
    ],
    [
      'bad port',
      'events-linux',
      (v) => {
        v.events[2].dport = 65536;
      },
    ],
  ])('rejects %s', (_name, name, change) => {
    const value = fixture(name);
    change(value);
    rejects(value);
  });
});
