import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import LocalSecurityResults from '../../../frontend/observatory/components/LocalSecurityResults.svelte';
import type { LocalReview } from '../../../frontend/observatory/runtime/local-security';

const capture = (issues: Record<string, unknown>[] = []): LocalReview => ({
  id: 'coverage-context-capture',
  mode: 'scan',
  adapter: 'project',
  directory: 'Selected project',
  createdAt: '2026-10-06T09:00:00.000Z',
  report: {
    complete: false,
    findings: [{ title: 'Review this hook', path: '.claude/settings.json', severity: 'high' }],
    files: [{ path: '.claude/settings.json', kind: 'agent-config' }],
    issues,
  },
  snapshot: null,
  canSaveSnapshot: false,
});

const options = (review: LocalReview, action = vi.fn()) => ({
  review,
  action,
  pending: false,
  preview: false,
  savedAcceptance: false,
});

it('keeps bounded collection caveats beside findings with every notice reachable', async () => {
  const action = vi.fn();
  const review = capture([
    { reason: 'file-unavailable', path: 'missing.json' },
    { reason: 'file-limit', path: 'large.py' },
    { reason: 'linked-file-skipped', path: 'linked.sh' },
    { reason: 'instruction-semantics-not-analyzed', path: 'AGENTS.md' },
  ]);
  render(LocalSecurityResults, options(review, action));
  const summary = screen.getByRole('region', { name: 'Coverage summary' });
  expect(within(summary).getByText('file unavailable · Local · missing.json')).toBeVisible();
  expect(within(summary).getAllByRole('listitem')).toHaveLength(3);
  expect(summary).toHaveTextContent('First 3 of 4 coverage notices.');
  expect(summary).not.toHaveTextContent('instruction semantics not analyzed');
  expect(screen.getByRole('button', { name: /Findings/ })).toHaveAttribute(
    'aria-current',
    'location',
  );
  expect(screen.getByRole('region', { name: /Findings/ })).toHaveTextContent('Review this hook');
  expect(screen.getByText('Safety not determined')).toBeVisible();

  await fireEvent.click(within(summary).getByRole('button', { name: 'Review scope and coverage' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Scope & coverage/ })).toHaveFocus(),
  );
  const coverage = screen.getByRole('region', { name: /Scope & coverage/ });
  expect(within(coverage).getByText('instruction semantics not analyzed')).toBeVisible();
  expect(within(coverage).getByText('4 / 4 records')).toBeVisible();
  expect(action).not.toHaveBeenCalled();
});

it('retains evidence filters and coverage pagination through the persistent summary action', async () => {
  const review = capture(
    Array.from({ length: 25 }, (_, index) => ({
      reason: 'coverage-notice-' + index,
      path: 'file-' + index + '.json',
    })),
  );
  render(LocalSecurityResults, options(review));
  const findings = screen.getByRole('region', { name: /Findings/ });
  await fireEvent.input(within(findings).getByLabelText('Filter results'), {
    target: { value: 'hook' },
  });
  const openCoverage = screen.getByRole('button', { name: 'Review scope and coverage' });
  await fireEvent.click(openCoverage);
  const coverage = screen.getByRole('region', { name: /Scope & coverage/ });
  await fireEvent.click(within(coverage).getByRole('button', { name: 'Next' }));
  expect(within(coverage).getByText('coverage notice 24', { selector: 'strong' })).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: /Findings/ }));
  expect(within(findings).getByLabelText('Filter results')).toHaveValue('hook');
  await fireEvent.click(openCoverage);
  expect(within(coverage).getByText('coverage notice 24', { selector: 'strong' })).toBeVisible();
  expect(within(coverage).getByText('2 / 2')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Coverage summary' })).toHaveTextContent('file-0.json');
});

it('keeps an incomplete result explicit when the host provides no itemized caveats', () => {
  const review = capture();
  review.report.findings = [];
  render(LocalSecurityResults, options(review));
  expect(screen.getByRole('region', { name: 'Coverage summary' })).toHaveTextContent(
    'No itemized coverage notices were returned. The captured review is still incomplete.',
  );
  expect(screen.getByText('Incomplete coverage')).toBeVisible();
  expect(screen.getByText('Safety not determined')).toBeVisible();
});

it('retains separate local and external sources without changing imported claim uncertainty', () => {
  const review = capture();
  review.mode = 'import';
  review.report = {
    complete: false,
    local: { issues: [{ reason: 'file-unavailable', path: 'hook.py' }] },
    external: { issues: [{ reason: 'source-match-unavailable', path: 'hook.py' }] },
  };
  render(LocalSecurityResults, options(review));
  const summary = screen.getByRole('region', { name: 'Coverage summary' });
  expect(summary).toHaveTextContent('file unavailable · Local · hook.py');
  expect(summary).toHaveTextContent('source match unavailable · External report · hook.py');
  expect(screen.getByText(/External claims are unverified/)).toBeVisible();
});

it('does not transfer deferred summary-action focus into a hidden retained workspace', async () => {
  const view = render(LocalSecurityResults, options(capture([{ reason: 'file-unavailable' }])));
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  view.container.hidden = true;
  await fireEvent.click(
    screen.getByRole('button', { name: 'Review scope and coverage', hidden: true }),
  );
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});
