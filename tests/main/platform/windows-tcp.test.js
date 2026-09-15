import { describe, it, expect } from 'vitest';
import tcp from '../../../src/main/platform/windows-tcp.js';

const row = (extra = {}) => ({
  OwningProcess: 42,
  RemoteAddress: '203.0.113.1',
  RemotePort: 443,
  LocalAddress: '192.0.2.1',
  LocalPort: 50001,
  State: 5,
  ...extra,
});
const parse = (rows) => tcp.parseTcpRows(JSON.stringify(rows), [42, 43]);

describe('direct Windows TCP observation', () => {
  it('preserves simultaneous sockets, both endpoints, both families and IPv6 scope', () => {
    const rows = [
      row(),
      row({ LocalPort: 50002 }),
      row({ OwningProcess: 43, RemoteAddress: 'fe80::1%12', LocalAddress: 'fe80::2%12', State: 3 }),
    ];
    expect(parse(rows)).toEqual([
      {
        pid: 42,
        ip: '203.0.113.1',
        port: 443,
        localIp: '192.0.2.1',
        localPort: 50001,
        state: 'Established',
      },
      {
        pid: 42,
        ip: '203.0.113.1',
        port: 443,
        localIp: '192.0.2.1',
        localPort: 50002,
        state: 'Established',
      },
      {
        pid: 43,
        ip: 'fe80::1%12',
        port: 443,
        localIp: 'fe80::2%12',
        localPort: 50001,
        state: 'SynSent',
      },
    ]);
  });
  it('preserves all retained TCP states and unknown enum values', () => {
    expect(
      parse([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 77].map((State) => row({ State }))).map(
        (r) => r.state,
      ),
    ).toEqual([
      'Closed',
      'SynSent',
      'SynReceived',
      'Established',
      'FinWait1',
      'FinWait2',
      'CloseWait',
      'Closing',
      'LastAck',
      'TimeWait',
      'DeleteTCB',
      '77',
    ]);
  });
  it('keeps the literal legacy exclusions without widening them', () => {
    const rows = [
      row({ State: 2 }),
      row({ State: 100 }),
      ...['0.0.0.0', '::', '127.0.0.1', '::1'].map((RemoteAddress) => row({ RemoteAddress })),
      row({ RemoteAddress: '127.0.0.2' }),
      row({ RemoteAddress: '::ffff:127.0.0.1' }),
    ];
    expect(parse(rows).map((r) => r.ip)).toEqual(['127.0.0.2', '::ffff:127.0.0.1']);
  });
  it('returns true empty observations and normalizes one object', () => {
    expect(tcp.parseTcpRows('  ', [42])).toEqual([]);
    expect(parse([])).toEqual([]);
    expect(parse(row())).toEqual(parse([row()]));
  });
  it.each([
    null,
    {},
    row({ State: null }),
    row({ State: 'Established' }),
    row({ OwningProcess: 99 }),
    row({ RemoteAddress: null }),
    row({ LocalAddress: 'invalid' }),
    row({ RemotePort: -1 }),
    row({ LocalPort: 65536 }),
  ])('rejects corrupt or out-of-scope observations (%j)', (value) => {
    expect(() => parse([row(), value])).toThrow();
  });
  it('rejects invalid JSON', () => expect(() => tcp.parseTcpRows('broken', [42])).toThrow());
  it('builds one PID-filtered query with mandatory fields and propagating errors', () => {
    const script = tcp.buildTcpQuery([42, 43, 42]);
    expect(script).toContain("-Filter 'OwningProcess=42 OR OwningProcess=43'");
    expect(script).toContain('-ClassName MSFT_NetTCPConnection');
    expect(script).toContain('OwningProcess,RemoteAddress,RemotePort,LocalAddress,LocalPort,State');
    expect(script).toContain('-ErrorAction Stop');
    expect(script).not.toContain('Get-NetTCPConnection');
  });
  it.each([[], [0], [-1], [1.5], [4294967296], ['42 OR 1=1']])(
    'rejects unsafe query targets (%j)',
    (pids) => {
      expect(() => tcp.buildTcpQuery(pids)).toThrow();
    },
  );
});
