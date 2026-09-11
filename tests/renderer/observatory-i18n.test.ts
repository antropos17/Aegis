import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { translator } from '../../frontend/observatory/runtime/i18n';
import portuguese from '../../frontend/observatory/translations/pt-BR.json';

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
});
