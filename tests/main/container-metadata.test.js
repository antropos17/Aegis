import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseContainerOutput } = require('../../src/main/container-metadata');
const firstId = 'a'.repeat(64);
const secondId = 'b'.repeat(64);

function row(runtime, Names = 'agent-zero', Image = 'agent0ai/agent-zero:latest', ID = firstId) {
  return JSON.stringify({
    ID,
    Image,
    Names,
    ...(runtime === 'podman' ? { State: 'running' } : {}),
  });
}

describe.each(['docker', 'podman'])('%s projected container names', (runtime) => {
  it.each([256, 8192])('retains a matching container with a %s-character name', (length) => {
    const name = 'n'.repeat(length);
    expect(parseContainerOutput(row(runtime, name), runtime)).toEqual([
      {
        id: `${runtime}:${firstId}`,
        containerId: firstId,
        name,
        image: 'agent0ai/agent-zero:latest',
        agent: 'Agent Zero',
        match: 'image',
        runtime,
      },
    ]);
  });

  it.each([256, 8192])(
    'keeps Agent Zero visible beside an unrelated %s-character container name',
    (length) => {
      const output = [
        row(runtime),
        row(runtime, 'n'.repeat(length), 'alpine:latest', secondId),
      ].join('\n');
      expect(parseContainerOutput(output, runtime)).toEqual(
        parseContainerOutput(row(runtime), runtime),
      );
      expect(parseContainerOutput(output, runtime)).toHaveLength(1);
    },
  );

  it('rejects the whole page when a sibling name exceeds the 8192-character field bound', () => {
    const output = [row(runtime), row(runtime, 'n'.repeat(8193), 'alpine:latest', secondId)].join(
      '\n',
    );
    expect(parseContainerOutput(output, runtime)).toBeNull();
  });

  it.each(['\u0000', '\n', '\r', '\t', '\u001f', '\u007f'])(
    'rejects a control in a long unrelated name: %j',
    (control) => {
      const output = [
        row(runtime),
        row(runtime, 'n'.repeat(256) + control, 'alpine:latest', secondId),
      ].join('\n');
      expect(parseContainerOutput(output, runtime)).toBeNull();
    },
  );
});

describe('Docker projected name aliases', () => {
  it('accepts long link-name components while retaining only the canonical name', () => {
    const alias = `${'n'.repeat(256)}/${'a'.repeat(256)}`;
    expect(parseContainerOutput(row('docker', `agent-zero,${alias}`), 'docker')).toEqual(
      parseContainerOutput(row('docker'), 'docker'),
    );
  });

  it('retains the 32-name bound', () => {
    const names = Array(32).fill('agent-zero').join(',');
    expect(parseContainerOutput(row('docker', names), 'docker')).toHaveLength(1);
    expect(parseContainerOutput(row('docker', names + ',agent-zero'), 'docker')).toBeNull();
  });
});
