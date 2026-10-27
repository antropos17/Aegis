import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { translator } from '../../frontend/observatory/runtime/i18n';
import portuguese from '../../frontend/observatory/translations/pt-BR.json';
import { toolContextView } from '../../frontend/observatory/runtime/tool-context-display';

describe('Observatory localization', () => {
  it('falls back to the English source and preserves interpolated data verbatim', () => {
    const pt = translator('pt');
    expect(pt('Agent radar')).toBe('Radar de agentes');
    expect(translator('unsupported')('Agent radar')).toBe('Agent radar');
    expect(pt('New English message')).toBe('New English message');
    expect(pt('constructor')).toBe('constructor');
    expect(
      pt('Select {value0}, {value1} processes, risk {value2}', {
        value0: '<script>Network/{value1}</script>',
        value1: 2,
        value2: 42,
      }),
    ).toBe('Selecionar <script>Network/{value1}</script>, 2 processos, risco 42');
    expect(pt('Select {value0}, {value1} processes, risk {value2}')).toContain('{value0}');
  });

  it('keeps every catalog placeholder and covers literal messages in active components', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [source, translated] of Object.entries(portuguese)) {
      expect(translated.trim(), source).not.toBe('');
      expect(placeholders(translated), source).toEqual(placeholders(source));
    }
    const root = resolve('frontend/observatory');
    const files = [
      'App.svelte',
      ...readdirSync(resolve(root, 'components'))
        .filter((file) => file.endsWith('.svelte'))
        .map((file) => 'components/' + file),
    ];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8');
      for (const match of source.matchAll(/\$t\((['"])((?:\\.|(?!\1).)*)\1/g)) {
        const message = match[2].replace(/\\(['"\\])/g, '$1');
        expect(Object.hasOwn(portuguese, message), `${file}: ${message}`).toBe(true);
      }
    }
  });

  it('translates the dynamically selected native setup failure', () => {
    expect(
      translator('pt')('Native setup files are unavailable or failed their integrity checks.'),
    ).toBe(
      'Os arquivos de configuração nativos estão indisponíveis ou falharam nas verificações de integridade.',
    );
  });

  it('translates the dynamically selected invalid policy outcome', () => {
    expect(
      translator('pt')(
        'Select a valid AEGIS Bash policy using schema 1 or the supported schema 2.',
      ),
    ).toBe(
      'Selecione uma política Bash válida do AEGIS que use o esquema 1 ou o esquema 2 compatível.',
    );
  });

  it('translates the closed tool-context display vocabulary and timing templates', () => {
    const candidate = {
      source: 'claude-code',
      sessionRef: 'a'.repeat(64),
      callRef: 'b'.repeat(64),
      toolName: 'Read',
      argsDigest: 'c'.repeat(64),
      objectDigest: 'd'.repeat(64),
      argsShape: { operation: 'read', objectKind: 'path' },
      startMs: 1000,
      endMs: 2000,
      deltaMs: 250,
      strength: 'confirmed',
      reasons: [],
    };
    const capsule = {
      schemaVersion: 1,
      relation: 'preceded-by',
      strength: 'confirmed',
      reasons: ['exact-binding-object-and-interval'],
      candidateCount: 1,
      candidatesTruncated: false,
      ambiguous: false,
      objectMatch: 'matched',
      sessionBinding: 'confirmed',
      candidates: [candidate],
    };
    const reasons = [
      'ambiguous-tool-calls',
      'argument-limit',
      'binding-limit',
      'binding-unavailable-or-outside-lifetime',
      'call-limit',
      'candidate-limit',
      'clock-skew-unavailable',
      'clock-skew-assumed-local',
      'duplicate-call-id',
      'duplicate-tool-end',
      'end-time-unavailable',
      'exact-binding-object-and-interval',
      'exact-session-binding',
      'invalid-encoding-or-json',
      'invalid-event-or-bindings',
      'invalid-input',
      'invalid-json-record',
      'invalid-record',
      'invalid-selection',
      'invalid-session-metadata',
      'invalid-time-tolerance',
      'invalid-tool-arguments',
      'invalid-tool-end',
      'invalid-tool-record',
      'no-qualifying-tool-call',
      'object-unavailable',
      'oversize-input',
      'oversize-record',
      'partial-source',
      'process-binding-mismatch',
      'process-identity-unavailable',
      'record-limit',
      'session-binding-inferred',
      'session-binding-mismatch',
      'session-metadata-unavailable',
      'session-mismatch',
      'source-unavailable',
      'time-overlap-without-object-match',
      'timestamp-unavailable',
      'truncated-input',
      'unsupported-format',
      'unsupported-history-edit',
      'unsupported-source',
      'unsupported-tool-record',
      'context-invalid',
      'context-unavailable',
      'context-truncated',
    ];
    const labels = new Set([
      'Other tool',
      'Additional metadata',
      'Additional metadata unavailable',
    ]);
    const variants = [
      capsule,
      undefined,
      null,
      ...reasons.map((reason) => ({ ...capsule, reasons: [reason] })),
      {
        ...capsule,
        candidates: [{ ...candidate, endMs: null, reasons: ['end-time-unavailable'] }],
      },
    ];
    for (const toolContext of variants) {
      const view = toolContextView(toolContext === undefined ? {} : { toolContext });
      for (const label of [
        view.association,
        view.binding,
        view.object,
        ...view.reasons,
        ...view.candidates.flatMap((item) => [item.association, item.relation, item.timing]),
      ])
        labels.add(label);
    }
    const pt = translator('pt');
    for (const label of labels) {
      expect(Object.hasOwn(portuguese, label), label).toBe(true);
      expect(pt(label), label).not.toBe(label);
    }
    expect(
      pt('Observation {deltaMs} ms after reported tool start; within reported tool window', {
        deltaMs: 250,
      }),
    ).toBe(
      'Observação 250 ms após o início informado da ferramenta; dentro do intervalo informado da ferramenta',
    );
  });

  it('translates Claude reporting statuses, reasons, and operation outcomes', () => {
    const labels = [
      'Select a valid AEGIS Bash policy using schema 1 or the supported schema 2.',
      'Broker command copied. Run it in PowerShell and compare the confirmation code.',
      'A reporting session is already active.',
      'Prepare the separate Claude profile before starting a session.',
      'The current hook or policy could not be verified for the selected working folder. Review the profile and policy.',
      'The previous native reader did not confirm shutdown. Another reporting session is unavailable.',
      'Terminal session preparation cancelled.',
      'Reporting stopped. A previously launched Claude process may still be running.',
      'The terminal session could not be prepared.',
      'Selected policy decision',
      'Hook adapter failure',
      'Provider confirmation requested for supported command',
      'Project script can run unchecked actions; provider confirmation requested',
      'Patch contents, written paths and executable are unverified; provider confirmation requested',
      'Declared sensitive filename',
      'Declared destructive command',
      'Unsupported command or input',
      'No reporting session',
      'Waiting for the terminal broker',
      'Waiting for native code confirmation',
      'Session listening; delivery remains unknown',
      'Session refused',
      'Session expired',
      'Reporting session ended',
    ];
    const pt = translator('pt');
    for (const label of labels) {
      expect(Object.hasOwn(portuguese, label), label).toBe(true);
      expect(pt(label), label).not.toBe(label);
    }
  });
});
