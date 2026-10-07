import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { cleanup, auditChild, gatewayScenario } from './enforcement-evidence-fixtures.mjs';
import { createEvidenceReceiver } from './enforcement-evidence-receiver.mjs';
import {
  measureEvidenceScenario,
  summarizeEvidenceMeasurements,
} from './enforcement-evidence-measurements.mjs';
const require = createRequire(import.meta.url);
const evidence = require('../../src/main/enforcement-evidence');
async function receiverNegative(mode) {
  const parent = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(parent, 'aegis-evidence-'));
  const grantId = randomUUID(),
    operationId = randomUUID();
  let receiver;
  let completed = false;
  try {
    await fs.mkdir(path.join(root, 'grants'));
    const name =
      createHash('sha256')
        .update(mode === 'wrong-id' ? randomUUID() : grantId)
        .digest('hex') + '.used';
    if (mode !== 'absent')
      await fs.writeFile(
        path.join(root, 'grants', name),
        mode === 'malformed' ? '{}' : '{"consumed":true}\n',
        { flag: 'wx' },
      );
    receiver = await createEvidenceReceiver(root, grantId, () => operationId, 'normal');
    const { measurement } = await measureEvidenceScenario(
      () =>
        new Promise((resolve, reject) => {
          const request = http.request(
            receiver.endpoint.url,
            {
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + receiver.endpoint.bearerToken,
                'content-type': 'application/json',
              },
            },
            (response) => {
              let bytes = 0;
              const chunks = [];
              response.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > 4096) response.destroy();
                else chunks.push(chunk);
              });
              response.once('end', () => {
                try {
                  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                  completed =
                    response.statusCode === 200 &&
                    value.result?.structuredContent?.accepted === true;
                  resolve();
                } catch {
                  reject(Error('fixture-response-invalid'));
                }
              });
              response.once('error', reject);
            },
          );
          request.setTimeout(1000, () => request.destroy(Error('fixture-timeout')));
          request.once('error', reject);
          request.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'record', arguments: { recipient: 'dummy' } },
            }),
          );
        }),
    );
    return {
      mode: 'receiver-' + mode,
      passed:
        receiver.count() === 1 &&
        receiver.observations[0]?.consumedRecord === mode &&
        receiver.observations[0]?.effect === 'expected',
      receiverCalls: receiver.count(),
      completed,
      observedEffects: receiver.observations.filter((row) => row.effect === 'expected').length,
      measurement,
      effectDespiteMissingAuthority: receiver.observations[0]?.effect === 'expected',
    };
  } finally {
    await receiver?.close();
    await cleanup(root, parent);
  }
}

// Same fixed record operation and independent sentinel oracle in both arms.
// Alternate order across three pairs; retain every measured call, excluding setup.
async function measureWorkflows() {
  const samples = [];
  for (let pair = 0; pair < 3; pair++) {
    for (const arm of pair % 2 ? ['gateway', 'direct'] : ['direct', 'gateway']) {
      const row = await (arm === 'direct' ? receiverNegative('absent') : gatewayScenario('normal'));
      samples.push({
        pair,
        arm,
        passed: row.passed,
        completed: row.completed,
        observedEffects: row.observedEffects,
        measurement: row.measurement,
      });
    }
  }
  return summarizeEvidenceMeasurements(samples);
}
/** Run fixed local policy/gateway/audit/effect scenarios; no native provider or guest runs.
 * @returns {Promise<object>} Bounded metadata-only report. @since v0.17.0 */
export async function qualifyEnforcementEvidence() {
  const rows = [];
  let normal;
  for (const mode of [
    'normal',
    'deny',
    'ask',
    'consume-failed',
    'lost-response',
    'observer-throw',
    'observer-reject',
    'observer-pending',
  ]) {
    const row = await gatewayScenario(mode);
    if (mode === 'normal') normal = row;
    rows.push({
      mode,
      passed: row.passed,
      policyDecision: row.policyDecision,
      receiverCalls: row.receiverCalls,
      completeness: row.assessed?.completeness || 'not-run',
      observerLoss: row.observer?.lost || 0,
    });
  }
  for (const mode of ['absent', 'malformed', 'wrong-id']) rows.push(await receiverNegative(mode));
  const bytes = evidence.encodeEnforcementEvidence(normal.value),
    anchor = evidence.createEnforcementEvidenceAnchor(bytes, {
      observerLoss: 0,
      auditLoss: 0,
      pending: 0,
      terminalKnown: true,
    });
  const truncated = { ...normal.value, records: normal.records.slice(0, -1) };
  rows.push({
    mode: 'forged-valid-prefix',
    passed:
      evidence.assessEnforcementEvidence(evidence.encodeEnforcementEvidence(truncated), anchor)
        .completeness === 'incomplete',
  });
  const key = evidence.createEvidenceCheckpointKey(),
    checkpoint = evidence.signEvidenceCheckpoint(anchor, key),
    other = { ...normal.value, context: { ...normal.value.context, sessionId: randomUUID() } };
  const otherAnchor = evidence.createEnforcementEvidenceAnchor(
    evidence.encodeEnforcementEvidence(other),
    { observerLoss: 0, auditLoss: 0, pending: 0, terminalKnown: true },
  );
  rows.push({
    mode: 'checkpoint-context-replay',
    passed:
      evidence.verifyEvidenceCheckpoint(checkpoint, anchor, key) &&
      !evidence.verifyEvidenceCheckpoint(checkpoint, otherAnchor, key) &&
      !evidence.verifyEvidenceCheckpoint(
        checkpoint,
        anchor,
        evidence.createEvidenceCheckpointKey(),
      ),
  });
  for (const mode of ['normal', 'eviction', 'recovery']) {
    const parent = await fs.realpath(os.tmpdir()),
      root = await fs.mkdtemp(path.join(parent, 'aegis-evidence-'));
    try {
      const audit = await auditChild(root, normal.records, mode);
      const audited = { ...normal.value, records: audit.records };
      const auditAnchor = evidence.createEnforcementEvidenceAnchor(bytes, {
        observerLoss: 0,
        auditLoss: audit.status.droppedEntries,
        pending: audit.status.bufferDepth,
        terminalKnown: true,
      });
      const assessment = evidence.assessEnforcementEvidence(
        evidence.encodeEnforcementEvidence(audited),
        auditAnchor,
      );
      rows.push({
        mode: 'audit-' + mode,
        passed:
          audit.chainValid &&
          audit.validPrefix &&
          audit.copied &&
          (mode === 'eviction'
            ? audit.status.droppedEntries === 1 && assessment.completeness === 'incomplete'
            : assessment.completeness === 'complete') &&
          (mode !== 'recovery' || audit.failedAppend),
        dropped: audit.status.droppedEntries,
        chainValid: audit.chainValid,
        completeness: assessment.completeness,
      });
      if (mode === 'eviction') {
        await fs.unlink(path.join(root, 'valid-prefix.json'));
        const fresh = await auditChild(root, [], 'fresh');
        rows.push({
          mode: 'fresh-counters-do-not-repair-history',
          passed:
            fresh.status.droppedEntries === 0 &&
            evidence.assessEnforcementEvidence(
              evidence.encodeEnforcementEvidence(audited),
              auditAnchor,
            ).completeness === 'incomplete',
        });
      }
    } finally {
      await cleanup(root, parent);
    }
  }
  const measurements = await measureWorkflows();
  return {
    schemaVersion: 1,
    passed:
      rows.every((row) => row.passed) &&
      measurements.samples.every((row) => row.passed && row.completed && row.observedEffects === 1),
    scope: 'local-developer-evidence',
    rows,
    measurements,
    launchAllowed: false,
    notRun: [
      'native-provider-hooks',
      'real-credentials',
      'guest-isolation',
      'hostile-storage',
      'power-loss',
      'production-launch',
      'A1-A4',
    ],
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw Error('fixture-selector');
    const value = await qualifyEnforcementEvidence();
    process.stdout.write(JSON.stringify(value) + '\n');
    process.exitCode = value.passed ? 0 : 2;
  } catch {
    process.stdout.write(
      '{"passed":false,"error":"evidence-qualification-unavailable","launchAllowed":false}\n',
    );
    process.exitCode = 2;
  }
}
