import { expect, it } from 'vitest';
import { qualifyModelBroker } from '../../scripts/qualification/qualify-model-broker.mjs';

it.each([
  'json',
  'sse',
  'tls',
  'secret-sse',
  'lost-response',
  'replay',
  'revoked',
  'route',
  'persist',
  'quota',
])(
  'independently qualifies the fixed %s dummy scenario without model content in receipts',
  async (mode) => {
    const result = await qualifyModelBroker(mode);
    expect(result).toMatchObject({ passed: true, developerOnly: true, launchAllowed: false });
    expect(JSON.stringify(result)).not.toContain('dummy-model-output');
    expect(JSON.stringify(result)).not.toContain('dummy-input-canary');
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  },
);

it('refuses arbitrary server, endpoint, model or credential selectors', async () => {
  await expect(qualifyModelBroker('https://external.invalid')).rejects.toThrow(
    'model-qualification-mode-invalid',
  );
});
