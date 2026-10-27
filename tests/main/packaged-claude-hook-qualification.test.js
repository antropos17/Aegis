import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { post, failureSummary } = require('../../scripts/qualification/packaged-claude-hook.cjs');

it('keeps malformed child output out of failure receipts', () => {
  let receipt;
  try {
    JSON.parse('PRIVATE_CHILD_OUTPUT');
  } catch {
    receipt = failureSummary('PostToolUse-after');
  }
  expect(receipt).toEqual({
    complete: false,
    failureStage: 'PostToolUse-after',
    failure: 'Qualification failed; see bounded stage and case evidence.',
  });
  expect(JSON.stringify(receipt)).not.toContain('PRIVATE_CHILD_OUTPUT');
});

it.each(['hang', 'oversize'])('bounds a %s local observer response', async (behavior) => {
  const server = http.createServer((_request, response) => {
    if (behavior === 'oversize') response.end('x'.repeat(8193));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    await expect(
      post({ port: server.address().port, sessionId: 'fixture' }, 'claim', {}, null, 100),
    ).rejects.toThrow(behavior === 'hang' ? 'deadline exceeded' : 'exceeded limit');
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
