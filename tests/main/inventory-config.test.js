import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { summarizeConfig, PARSE_DEPTH } = require('../../src/main/inventory-config');
const summarize = (
  text,
  format = 'json',
  sections = ['servers'],
  projects = false,
  gemini = false,
) => summarizeConfig(Buffer.from(text), format, sections, projects, gemini);

describe('inventory configuration summaries', () => {
  it('parses JSONC comments and trailing commas without corrupting quoted URLs or escapes', () => {
    const result = summarize(
      String.raw`// PRIVATE_COMMENT
      { "servers": {
        "PRIVATE_NAME": { "url": "https://example.invalid/a//b/*c*/", "args": ["\\\"",], },
        /* between declarations */ "second": {},
      }, }`,
      'jsonc',
    );
    expect(result).toEqual({
      parseStatus: 'parsed',
      declaredEntries: 2,
      declaredSections: { servers: 2 },
    });
  });

  it('parses Gemini comments while rejecting trailing commas left by comment stripping', () => {
    const commented = String.raw`// PRIVATE_COMMENT
      { "mcpServers": { /* allowed */ "one": { "url": "https://example.invalid/a//b" } } }`;
    expect(summarize(commented, 'json-comments', ['mcpServers'], false, true)).toMatchObject({
      parseStatus: 'parsed',
      declaredEntries: 1,
    });
    expect(summarize(commented, 'json', ['mcpServers'])).toEqual({ parseStatus: 'invalid-json' });
    const trailing = '{ "mcpServers": { "one": {}, }, }';
    expect(summarize(trailing, 'json-comments', ['mcpServers'], false, true)).toEqual({
      parseStatus: 'invalid-json-comments',
    });
    expect(summarize(trailing, 'jsonc', ['mcpServers'])).toMatchObject({
      parseStatus: 'parsed',
      declaredEntries: 1,
    });
  });

  it('accepts a UTF-8 BOM and counts missing sections as zero', () => {
    expect(summarize('\uFEFF{}')).toMatchObject({ parseStatus: 'parsed', declaredEntries: 0 });
    expect(summarize('', 'toml', ['mcp_servers', 'hooks'])).toMatchObject({
      parseStatus: 'parsed',
      declaredSections: { mcp_servers: 0, hooks: 0 },
    });
  });

  it('parses TOML quoted/dotted keys, inline tables, arrays and multiline strings', () => {
    const result = summarize(
      `
model = "PRIVATE_MODEL"
large_integer = 9223372036854775807
[mcp_servers."PRIVATE.dot.name"]
command = "DO_NOT_EXECUTE"
args = ["a", "b",]
env = { TOKEN = "PRIVATE_TOKEN" }
description = """PRIVATE_TEXT
[mcp_servers.not_a_server]
"""
[mcp_servers.second]
url = 'https://example.invalid/#fragment'
[hooks]
PreToolUse = [{ command = "DO_NOT_EXECUTE" }]
`,
      'toml',
      ['mcp_servers', 'hooks'],
    );
    expect(result).toEqual({
      parseStatus: 'parsed',
      declaredEntries: 2,
      declaredSections: { mcp_servers: 2, hooks: 1 },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each([
    ['json', '{"servers":{},}'],
    ['json', '// comment\n{}'],
    ['jsonc', '{"servers":{} garbage}'],
    ['jsonc', '{"servers":{}},{}'],
    ['jsonc', '{"servers":{} /* unclosed'],
    ['jsonc', "{'servers':{}}"],
    ['jsonc', '{servers:{}}'],
    ['jsonc', '{"servers":{"a":NaN}}'],
    ['jsonc', ''],
    ['toml', '[mcp_servers.broken'],
    ['toml', 'mcp_servers = "PRIVATE_UNCLOSED'],
    ['toml', '[mcp_servers.a]\n[mcp_servers.a]'],
  ])('rejects malformed %s instead of reporting a recovered partial parse', (format, text) => {
    expect(summarize(text, format)).toEqual({ parseStatus: `invalid-${format}` });
  });

  it.each(['json', 'jsonc'])(
    'rejects ambiguous duplicate keys in %s, including escaped names',
    (format) => {
      const result = summarize(String.raw`{"servers": {"a":{}}, "\u0073ervers": {}}`, format);
      expect(result).toEqual({ parseStatus: 'duplicate-key' });
      expect(summarize('{"servers":{"a":{"env":{"x":1,"x":2}}}}', format)).toEqual({
        parseStatus: 'duplicate-key',
      });
    },
  );

  it.each(['json', 'jsonc'])(
    'treats prototype keys in %s as data and never as inherited sections',
    (format) => {
      expect(summarize('{"__proto__":{"servers":{"hidden":{}}}}', format)).toMatchObject({
        declaredEntries: 0,
      });
      expect(
        summarize('{"servers":{"__proto__":{},"constructor":{},"toString":{}}}', format),
      ).toMatchObject({ declaredEntries: 3 });
      expect({}.servers).toBeUndefined();
    },
  );

  it('handles TOML prototype keys and never serializes untrusted values', () => {
    expect(
      summarize('[mcp_servers.__proto__]\ncommand="PRIVATE"', 'toml', ['mcp_servers']),
    ).toMatchObject({ parseStatus: 'parsed', declaredEntries: 1 });
    expect({}.command).toBeUndefined();
  });

  it.each(['[]', 'null', '{"servers":[]}', '{"servers":null}', '{"servers":1}'])(
    'rejects wrong section shape: %s',
    (text) => {
      expect(summarize(text)).toEqual({ parseStatus: 'invalid-shape' });
    },
  );

  it('does not mistake a TOML datetime for a declaration table', () => {
    expect(summarize('servers = 1979-05-27T07:32:00Z', 'toml')).toEqual({
      parseStatus: 'invalid-shape',
    });
  });

  it('bounds nesting and keeps oversized parser errors out of the report', () => {
    const deepJson =
      '{"servers":{},"private":' +
      '['.repeat(PARSE_DEPTH + 5) +
      '0' +
      ']'.repeat(PARSE_DEPTH + 5) +
      '}';
    expect(summarize(deepJson, 'jsonc')).toEqual({ parseStatus: 'parse-depth-limit' });
    const deepToml = 'private=' + '['.repeat(PARSE_DEPTH + 5) + '0' + ']'.repeat(PARSE_DEPTH + 5);
    expect(summarize(deepToml, 'toml')).toEqual({ parseStatus: 'invalid-toml' });
  });

  it('rejects invalid UTF-8 rather than fingerprinting one string and parsing a replacement', () => {
    const data = Buffer.concat([
      Buffer.from('{"servers":{"'),
      Buffer.from([0xff]),
      Buffer.from('":{}}}'),
    ]);
    expect(summarizeConfig(data, 'json', ['servers'])).toEqual({ parseStatus: 'invalid-encoding' });
  });

  it('bounds TOML dotted-key depth as well as nested arrays', () => {
    const text = 'private.'.repeat(PARSE_DEPTH + 2) + 'key = 1';
    expect(summarize(text, 'toml')).toEqual({ parseStatus: 'parse-depth-limit' });
  });

  it('counts Claude local scopes without exposing project paths or following references', () => {
    const result = summarize(
      JSON.stringify({
        mcpServers: { global: {} },
        projects: { PRIVATE_PATH: { mcpServers: { a: {}, b: {} } }, SECOND_PRIVATE_PATH: {} },
      }),
      'json',
      ['mcpServers'],
      true,
    );
    expect(result).toEqual({
      parseStatus: 'parsed',
      declaredEntries: 1,
      declaredSections: { mcpServers: 1 },
      projectScopedEntries: 2,
    });
  });

  it.each([{ projects: [] }, { projects: { p: null } }, { projects: { p: { mcpServers: [] } } }])(
    'rejects malformed Claude local scope',
    (config) => {
      expect(summarize(JSON.stringify(config), 'json', ['mcpServers'], true)).toEqual({
        parseStatus: 'invalid-shape',
      });
    },
  );

  it('reports unsupported formats explicitly', () => {
    expect(summarize('anything', 'yaml')).toEqual({ parseStatus: 'unsupported-format' });
  });

  it('counts Gemini MCP declarations and filters without exposing their values', () => {
    const result = summarize(
      JSON.stringify({
        mcp: { allowed: ['PRIVATE_SERVER', 'other'], excluded: ['PRIVATE_BLOCKED'] },
        mcpServers: {
          PRIVATE_SERVER: {
            command: 'DO_NOT_EXECUTE',
            env: { TOKEN: 'PRIVATE_SECRET' },
            trust: true,
            includeTools: ['PRIVATE_TOOL'],
            excludeTools: ['PRIVATE_TOOL', 'other'],
          },
          other: { httpUrl: 'https://PRIVATE_HOST/mcp', trust: false },
          third: { command: 'DO_NOT_EXECUTE' },
        },
      }),
      'json',
      ['mcpServers'],
      false,
      true,
    );
    expect(result).toEqual({
      parseStatus: 'parsed',
      declaredEntries: 3,
      declaredSections: { mcpServers: 3 },
      geminiMcpDeclarations: {
        allowed: { present: true, entries: 2 },
        excluded: { present: true, entries: 1 },
        trustTrueServers: 1,
        trustFalseServers: 1,
        includeToolsServers: 1,
        includeToolsEntries: 1,
        excludeToolsServers: 1,
        excludeToolsEntries: 2,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|DO_NOT_EXECUTE/);
  });

  it('distinguishes absent Gemini filters from declared empty filters', () => {
    expect(summarize('{}', 'json', ['mcpServers'], false, true)).toMatchObject({
      geminiMcpDeclarations: {
        allowed: { present: false, entries: 0 },
        excluded: { present: false, entries: 0 },
        trustTrueServers: 0,
        trustFalseServers: 0,
      },
    });
    expect(
      summarize('{"mcp":{"allowed":[],"excluded":[]}}', 'json', ['mcpServers'], false, true),
    ).toMatchObject({
      geminiMcpDeclarations: {
        allowed: { present: true, entries: 0 },
        excluded: { present: true, entries: 0 },
      },
    });
  });

  it.each([
    { mcp: [] },
    { mcp: { allowed: 'PRIVATE_SERVER' } },
    { mcp: { excluded: [1] } },
    { mcpServers: [] },
    { mcpServers: { server: null } },
    { mcpServers: { server: { trust: 'true' } } },
    { mcpServers: { server: { includeTools: 'PRIVATE_TOOL' } } },
    { mcpServers: { server: { excludeTools: [null] } } },
  ])('reports malformed Gemini MCP declaration shape without values: %j', (value) => {
    expect(summarize(JSON.stringify(value), 'json', ['mcpServers'], false, true)).toEqual({
      parseStatus: 'invalid-shape',
    });
  });
});
