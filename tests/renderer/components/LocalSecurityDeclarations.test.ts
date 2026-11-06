import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import LocalSecurityResults from '../../../frontend/observatory/components/LocalSecurityResults.svelte';
import { language } from '../../../frontend/observatory/runtime/i18n';
import {
  mcpDeclarations,
  type LocalReview,
} from '../../../frontend/observatory/runtime/local-security';

const hash = 'a'.repeat(64);
const review = (components: Record<string, unknown>[]): LocalReview => ({
  id: 'captured-review',
  mode: 'inventory',
  adapter: 'project',
  directory: 'Selected project',
  createdAt: '2026-09-26T09:00:00.000Z',
  report: { complete: true, components, issues: [], packages: [] },
  snapshot: null,
  canSaveSnapshot: false,
});

it('shows redacted declarations in a dedicated section beside MCP tools', async () => {
  const components = [
    {
      path: '.mcp.json',
      kind: 'mcp',
      parseStatus: 'parsed',
      declaredSections: { mcpServers: 2 },
      provenance: { agent: 'shared', scope: 'project' },
      sha256: hash,
      hiddenServerName: 'PRIVATE_SERVER_NAME',
    },
    {
      path: '.gemini/settings.json',
      kind: 'agent-config',
      parseStatus: 'parsed',
      declaredSections: { mcpServers: 1 },
      provenance: { agent: 'gemini-cli', scope: 'project' },
      geminiMcpDeclarations: {
        allowed: { present: true, entries: 0 },
        excluded: { present: false, entries: 0 },
        trustTrueServers: 1,
        trustFalseServers: 0,
        includeToolsServers: 1,
        includeToolsEntries: 3,
        excludeToolsServers: 0,
        excludeToolsEntries: 0,
        hiddenUrl: 'https://PRIVATE.example.invalid',
      },
    },
    {
      path: '.codex/config.toml',
      kind: 'agent-config',
      parseStatus: 'invalid-toml',
      provenance: { agent: 'codex', scope: 'project' },
    },
    {
      path: '.claude.json',
      kind: 'mcp',
      parseStatus: 'parsed',
      declaredSections: { mcpServers: 1 },
      projectScopedEntries: 3,
      provenance: { agent: 'claude-code', scope: 'user-and-project-local' },
    },
    { path: 'AGENTS.md', kind: 'instruction', provenance: { agent: 'shared', scope: 'project' } },
  ];
  const result = review(components);
  result.report.catalog = { complete: true, tools: [{ id: hash, sha256: hash }] };
  render(LocalSecurityResults, {
    review: result,
    pending: false,
    preview: false,
    savedAcceptance: false,
    action: vi.fn(),
  });
  const tabs = within(
    screen.getByRole('navigation', { name: 'Local review sections' }),
  ).getAllByRole('button');
  const toolsTab = screen.getByRole('button', { name: /MCP tools/ });
  const declarationsTab = screen.getByRole('button', { name: /MCP declarations/ });
  expect(tabs.indexOf(declarationsTab)).toBe(tabs.indexOf(toolsTab) + 1);
  expect(screen.getByRole('button', { name: /Files/ })).toHaveAttribute('aria-current', 'location');
  expect(screen.queryByRole('region', { name: 'MCP configuration declarations' })).toBeNull();
  await fireEvent.click(declarationsTab);
  const panel = screen.getByRole('region', { name: 'MCP configuration declarations' });
  expect(panel).toHaveTextContent('static counts from selected config files');
  expect(panel).toHaveTextContent('live MCP connections were not checked');
  const shared = within(panel).getByText('.mcp.json').closest('li');
  expect(shared).toHaveTextContent('Shared · Project');
  expect(shared).toHaveTextContent('Declared MCP servers: 2');
  const gemini = within(panel).getByText('.gemini/settings.json').closest('li');
  expect(gemini).toHaveTextContent('Gemini CLI · Project');
  expect(gemini).toHaveTextContent('Declared MCP servers: 1');
  expect(gemini).toHaveTextContent('Gemini trust flags: 1 true, 0 false');
  expect(gemini).toHaveTextContent('Global MCP filters: allowed 0, excluded not declared');
  expect(gemini).toHaveTextContent('include 1 lists / 3 entries; exclude 0 lists / 0 entries');
  const invalid = within(panel).getByText('.codex/config.toml').closest('li');
  expect(invalid).toHaveTextContent('Config parse unavailable');
  const claude = within(panel).getByText('.claude.json').closest('li');
  expect(claude).toHaveTextContent('Claude Code · User and project local');
  expect(claude).toHaveTextContent('Project-local MCP servers: 3');
  expect(panel).not.toHaveTextContent('AGENTS.md');
  expect(panel).not.toHaveTextContent('PRIVATE_SERVER_NAME');
  expect(panel).not.toHaveTextContent('PRIVATE.example.invalid');
  await fireEvent.click(screen.getByRole('button', { name: 'Review coverage' }));
  expect(screen.getByRole('button', { name: /Scope & coverage/ })).toHaveAttribute(
    'aria-current',
    'location',
  );
});

it('reads fresh comparison inventory and keeps malformed counts unavailable', () => {
  const declarations = mcpDeclarations({
    inventory: {
      components: [
        {
          path: '.codex/config.toml',
          kind: 'agent-config',
          parseStatus: 'parsed',
          declaredSections: { mcp_servers: -1 },
          provenance: { agent: 'codex', scope: 'user' },
        },
        {
          path: 'C:\\secret\\mcp.json',
          kind: 'mcp',
          parseStatus: 'parsed',
          declaredSections: { mcpServers: 7 },
          provenance: { agent: 'unrecognized-provider', scope: 'secret-scope' },
        },
        {
          path: '.gemini/settings.json',
          kind: 'agent-config',
          parseStatus: 'parsed',
          declaredSections: { mcpServers: 0 },
          declaredEntries: 9,
          provenance: { agent: 'gemini-cli', scope: 'project' },
        },
        {
          path: '.codex/hooks-only.config.toml',
          kind: 'agent-config',
          parseStatus: 'parsed',
          declaredSections: { hooks: 8 },
          declaredEntries: 8,
          provenance: { agent: 'codex', scope: 'user-profile' },
        },
      ],
    },
  });
  expect(declarations).toEqual([
    expect.objectContaining({
      path: '.codex/config.toml',
      provider: 'Codex',
      scope: 'User',
      parsed: true,
      servers: null,
    }),
    expect.objectContaining({
      path: 'Config #2',
      provider: 'Other provider',
      scope: 'Other scope',
      servers: 7,
    }),
    expect.objectContaining({ path: '.gemini/settings.json', servers: 0 }),
    expect.objectContaining({ path: '.codex/hooks-only.config.toml', servers: null }),
  ]);
});

it('omits the declaration panel when the selected report has no config inventory', () => {
  render(LocalSecurityResults, {
    review: review([{ path: 'AGENTS.md', kind: 'instruction' }]),
    pending: false,
    preview: false,
    savedAcceptance: false,
    action: vi.fn(),
  });
  expect(screen.queryByRole('region', { name: 'MCP configuration declarations' })).toBeNull();
  expect(screen.queryByRole('button', { name: /MCP declarations/ })).toBeNull();
});

it('formats the capture time in the selected language and keeps an invalid one unavailable', async () => {
  // Noon UTC keeps a two-digit local day in every timezone.
  const createdAt = '2026-10-19T12:00:00.000Z';
  const day = new Date(createdAt).getDate();
  const props = { pending: false, preview: false, savedAcceptance: false, action: vi.fn() };
  const captured = render(LocalSecurityResults, {
    ...props,
    review: { ...review([]), createdAt },
  });
  try {
    expect(captured.container).toHaveTextContent(`10/${day}/2026`);
    language.set('pt');
    await tick();
    expect(captured.container).toHaveTextContent(`${day}/10/2026`);
    captured.unmount();
    render(LocalSecurityResults, {
      ...props,
      review: { ...review([]), createdAt: 'not-a-date' },
    });
    expect(screen.getByText(/^Não informado ·/)).toBeVisible();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  } finally {
    language.set('en');
  }
});
