import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderReview, validReviewPolicy } = require('../../src/main/mcp-gateway-review-display');
const policy = (paths) => ({ schemaVersion: 1, tools: [{ name: 'record', paths }] });
const preview = (paths, current, previous) =>
  renderReview({ policy: policy(paths), tool: 'record', current, previous });
const unavailable = { ok: false, reason: 'review-display-unavailable' };

describe('owner-only disclosed MCP review', () => {
  it('identifies the first call and preserves the complete current arguments', () => {
    const current = { file: 'a.txt', data: { bytes: 12 }, verified: false };
    const result = preview(['/file', '/data/bytes', '/verified'], current);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.preview)).toEqual({
      tool: 'record',
      baseline: 'none',
      current,
      changes: [],
    });
  });

  it('shows an unchanged prior owner-approved call without implying a new approval', () => {
    const current = { name: 'same', values: [3, true] };
    const before = structuredClone(current);
    const result = preview(['/name', '/values/0', '/values/1'], current, before);
    expect(JSON.parse(result.preview)).toEqual({
      tool: 'record',
      baseline: 'previous-owner-approved-call',
      current,
      changes: [],
    });
    expect(current).toEqual(before);
  });

  it('shows nested additions, removals and changes, including array positions', () => {
    const before = { file: 'old', nested: { kept: 7, gone: 'x' }, list: [1, 2] };
    const current = { file: 'new', nested: { kept: 7, added: 'z' }, list: [1, 3, 4] };
    const original = structuredClone(before);
    const result = preview(
      ['/file', '/nested/kept', '/nested/gone', '/nested/added', '/list/0', '/list/1', '/list/2'],
      current,
      before,
    );
    expect(JSON.parse(result.preview).changes).toEqual([
      { path: '/file', type: 'changed', before: 'old', after: 'new' },
      { path: '/nested/gone', type: 'removed', before: 'x' },
      { path: '/list/1', type: 'changed', before: 2, after: 3 },
      { path: '/nested/added', type: 'added', after: 'z' },
      { path: '/list/2', type: 'added', after: 4 },
    ]);
    expect(before).toEqual(original);
  });

  it('requires explicit permission for empty containers and escapes JSON Pointer keys', () => {
    const current = { 'a/b': { '~key': [] }, empty: {} };
    const result = preview(['/a~1b/~0key', '/empty'], current);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.preview).current).toEqual(current);
    expect(preview(['/a/b/~key', '/empty'], current)).toEqual(unavailable);
    expect(preview(['/a~1b/~0key'], current)).toEqual(unavailable);
  });

  it('refuses a path that was allowed for the new call but not the prior call', () => {
    expect(preview(['/file'], { file: 'x' }, { file: 'x', private: 'not displayed' })).toEqual(
      unavailable,
    );
  });

  it('refuses sensitive-looking keys, controls, malformed policies and unlisted fields without echoing them', () => {
    const canary = 'private-canary-32480';
    for (const result of [
      preview(['/credential'], { credential: canary }),
      preview(['/file'], { file: canary, secret: 'x' }),
      preview(['/file'], { file: `a\u001b${canary}` }),
      renderReview({ policy: policy(['/bad~2path']), tool: 'record', current: { file: canary } }),
      renderReview({ policy: policy(['/file']), tool: 'different', current: { file: canary } }),
    ]) {
      expect(result).toEqual(unavailable);
      expect(JSON.stringify(result)).not.toContain(canary);
    }
  });

  it('escapes non-ASCII content and rejects overly large previews', () => {
    const result = preview(['/file'], { file: 'é\u202e' });
    expect(result.ok).toBe(true);
    expect(result.preview).toContain('\\u00e9\\u202e');
    expect(result.preview).not.toContain('é');
    expect(
      preview(['/a', '/b', '/c'], {
        a: 'x'.repeat(4096),
        b: 'x'.repeat(4096),
        c: 'x'.repeat(4096),
      }),
    ).toEqual(unavailable);
  });

  it('rejects malformed policy arrays and untrusted accessor or sparse data without calling getters', () => {
    let calls = 0;
    const value = {};
    Object.defineProperty(value, 'file', {
      enumerable: true,
      get: () => {
        calls++;
        return 'x';
      },
    });
    const sparse = Array(1);
    const badPolicy = policy(['/file']);
    badPolicy.tools[0].paths.push('/file');
    expect(validReviewPolicy(badPolicy)).toBe(false);
    expect(preview(['/file'], value)).toEqual(unavailable);
    expect(preview(['/list/0'], { list: sparse })).toEqual(unavailable);
    const input = { policy: policy(['/file']), tool: 'record', current: {} };
    Object.defineProperty(input, 'current', {
      enumerable: true,
      get: () => {
        calls++;
        return { file: 'unexpected' };
      },
    });
    expect(renderReview(input)).toEqual(unavailable);
    expect(calls).toBe(0);
  });

  it('rejects custom array prototypes before invoking inherited conversion or iteration', () => {
    let calls = 0;
    const list = [1];
    const prototype = Object.create(Array.prototype);
    prototype.toJSON = () => {
      calls++;
      return 'unexpected';
    };
    prototype[Symbol.iterator] = function* () {
      calls++;
      yield 'unexpected';
    };
    Object.setPrototypeOf(list, prototype);
    expect(preview(['/list/0'], { list })).toEqual(unavailable);
    const alteredPolicy = policy(['/list/0']);
    Object.setPrototypeOf(alteredPolicy.tools[0].paths, prototype);
    expect(validReviewPolicy(alteredPolicy)).toBe(false);
    expect(calls).toBe(0);
  });

  it.each(['passwd', 'pwd', 'auth', 'access_key', 'bearer'])(
    'refuses the sensitive key %s',
    (key) => {
      expect(validReviewPolicy(policy([`/${key}`]))).toBe(false);
      expect(preview([`/${key}`], { [key]: 'private' })).toEqual(unavailable);
    },
  );

  it('validates the whole policy, including tools not selected for this call', () => {
    const accepted = policy(['/file']);
    expect(validReviewPolicy(accepted)).toBe(true);
    const duplicate = { schemaVersion: 1, tools: [...accepted.tools, accepted.tools[0]] };
    expect(validReviewPolicy(duplicate)).toBe(false);
    expect(validReviewPolicy({ ...accepted, extra: true })).toBe(false);
    expect(
      validReviewPolicy({ schemaVersion: 1, tools: [{ name: 'record', paths: ['/token'] }] }),
    ).toBe(false);
    expect(renderReview(null)).toEqual(unavailable);
  });
});
