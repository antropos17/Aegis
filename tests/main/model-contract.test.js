import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseModelRequest, parseModelResponse } = require('../../src/main/model-contract');
const { createKnownSecretGuard } = require('../../src/main/mcp-gateway-secrets');

it.each([
  'oversized',
  'invalid-utf8',
  'invalid-unicode',
  'five-messages',
  'system',
  'extra-message',
  'fractional-quota',
  'duplicate-key',
])('rejects %s request before authority preparation', (mode) => {
  let value = { messages: [{ role: 'user', content: 'dummy' }], maxOutputTokens: 32 };
  if (mode === 'oversized') value.messages[0].content = 'x'.repeat(16384);
  if (mode === 'invalid-unicode') value.messages[0].content = '\ud800';
  if (mode === 'five-messages')
    value.messages = Array.from({ length: 5 }, () => ({ role: 'user', content: 'dummy' }));
  if (mode === 'system') value.messages[0].role = 'system';
  if (mode === 'extra-message') value.messages[0].tools = [];
  if (mode === 'fractional-quota') value.maxOutputTokens = 1.5;
  const bytes =
    mode === 'invalid-utf8'
      ? Buffer.from([255])
      : mode === 'duplicate-key'
        ? Buffer.from('{"messages":[],"messages":[],"maxOutputTokens":32}')
        : Buffer.from(JSON.stringify(value));
  expect(() => parseModelRequest(bytes)).toThrow();
});

it('accepts valid surrogate pairs while rejecting unknown SSE fields and events', () => {
  expect(
    parseModelRequest(
      Buffer.from(
        JSON.stringify({ messages: [{ role: 'user', content: '🙂' }], maxOutputTokens: 1 }),
      ),
    ),
  ).toBeDefined();
  const response = (body) => ({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    rawHeaders: ['Content-Type', 'text/event-stream'],
    body: Buffer.from(body),
  });
  const start = 'event: start\ndata: {"model":"dummy-model"}\n\n';
  const complete = 'event: complete\ndata: {"finishReason":"stop"}\n\n';
  for (const delta of [
    'event: tool\ndata: {"text":"x"}\n\n',
    'event: delta\ndata: {"text":"x","tool":"run"}\n\n',
  ])
    expect(() => parseModelResponse(response(start + delta + complete), 'dummy-model')).toThrow();
});

it('keeps the extracted guard bounded, exact, and unusable after close', () => {
  for (const values of [
    [],
    ['short'],
    ['duplicate-secret', 'duplicate-secret'],
    Array.from({ length: 33 }, (_, i) => 'secret-' + i),
    ['x'.repeat(257)],
  ])
    expect(() => createKnownSecretGuard(values)).toThrow('gateway-content-blocked');
  const guard = createKnownSecretGuard(['selected-dummy-secret']);
  guard.assertSafe({ output: 'safe dummy output' });
  expect(() =>
    guard.assertSafe({ output: Buffer.from('selected-dummy-secret').toString('hex') }),
  ).toThrow('gateway-content-blocked');
  guard.close();
  expect(() => guard.assertSafe({ output: 'safe dummy output' })).toThrow(
    'gateway-content-blocked',
  );
});
