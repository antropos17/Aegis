import { createModelOwner } from './model-broker-owner.mjs';
const fixture = { endpointPath: process.argv[2], ledgerPath: process.argv[3] };
let owner;
try {
  owner = await createModelOwner(fixture);
  const { capability, prepared } = owner.prepare();
  const result = await owner.broker.request(capability, prepared);
  process.stdout.write(
    JSON.stringify({ state: result.state, hasText: Object.hasOwn(result, 'text') }),
  );
} catch {
  process.stdout.write(JSON.stringify({ state: 'refused', hasText: false }));
} finally {
  owner?.close();
}
