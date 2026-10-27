import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ClaudeHookProfile from '../../../frontend/observatory/components/ClaudeHookProfile.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';
const snapshot = (status = 'inactive', extra: Record<string, unknown> = {}) => ({
  status,
  available: status === 'active',
  lossDetected: false,
  afterHooks: false,
  afterHooksAtAdmission: false,
  entries: [],
  ...extra,
});

it('offers an explicit snapshot-gated launch and reports review-required without passing a path', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: snapshot(),
    })
    .mockResolvedValueOnce({
      success: true,
      code: 'GUARD_SNAPSHOT_REVIEW_REQUIRED',
      canOpen: true,
      available: true,
    });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText('Prepared setup files are available for native review.');
  expect(
    screen.getByText(/The ordinary terminal session does not check a project snapshot/),
  ).toBeVisible();
  await fireEvent.click(
    screen.getByRole('button', { name: 'Prepare with accepted project snapshot' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('fresh Local security review');
  expect(review.mock.calls).toEqual([['status'], ['guard-start-snapshot']]);
});

it.each([
  [
    'POLICY_CREATE_REFUSED',
    'Não foi possível criar a nova política do projeto. O perfil não foi instalado.',
  ],
  [
    'POLICY_CREATE_UNCERTAIN',
    'Não foi possível verificar a criação da política. Revise os arquivos retidos antes de outra configuração.',
  ],
  [
    'POLICY_UNADOPTED',
    'Uma nova política foi retida, mas o perfil não foi instalado. Revise os arquivos retidos antes de outra configuração.',
  ],
])('shows the project policy action and %s in Portuguese', async (code, message) => {
  language.set('pt');
  try {
    const review = vi
      .fn()
      .mockResolvedValueOnce({ success: true, code: 'READY', canInstall: true })
      .mockResolvedValueOnce({ success: true, code, canInstall: false });
    render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
    await screen.findByText(
      'Os arquivos de configuração preparados estão disponíveis para revisão nativa.',
    );
    const button = await screen.findByRole('button', {
      name: 'Escolher projeto e revisar política integrada',
    });
    await fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(review.mock.calls).toEqual([['status'], ['install-project-policy']]);
  } finally {
    language.set('en');
  }
});

it('starts built-in project policy review with a fixed path-free operation', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({ success: true, code: 'READY', canInstall: true })
    .mockResolvedValueOnce({ success: true, code: 'CANCELLED', canInstall: true });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText('Prepared setup files are available for native review.');
  await fireEvent.click(
    screen.getByRole('button', { name: 'Choose project and review built-in policy' }),
  );
  await screen.findByText('Review cancelled. The hook was not changed.');
  expect(review.mock.calls).toEqual([['status'], ['install-project-policy']]);
});

it('connects install and separate removal to fixed desktop operations and confirmed outcomes', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({ success: true, code: 'READY', canInstall: true })
    .mockResolvedValueOnce({ success: true, code: 'INSTALLED', canRemove: true, canOpen: true })
    .mockResolvedValueOnce({ success: true, code: 'REMOVED', canInstall: true });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText('Prepared setup files are available for native review.');
  await fireEvent.click(screen.getByRole('button', { name: 'Choose policy and review install' }));
  await screen.findByText('Separate profile configured. Blocking is not verified.');
  await fireEvent.click(screen.getByRole('button', { name: 'Review AEGIS hook removal' }));
  await screen.findByText('The reviewed owned hook was removed.');
  expect(review.mock.calls).toEqual([['status'], ['install'], ['remove']]);
});

it('offers a fresh removal review after restart without sending paths, history or ownership claims', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'PROFILE_REVIEW_AVAILABLE',
      canRemove: false,
      canReviewExisting: true,
      canOpen: true,
      available: true,
    })
    .mockResolvedValueOnce({ success: true, code: 'OBSERVED_REMOVED', canInstall: true });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(
    'An existing separate profile is available for a fresh targeted removal review.',
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Review AEGIS hook removal' }));
  await screen.findByText(
    'The recognized AEGIS hook was removed after a fresh review. Unrelated settings were preserved.',
  );
  expect(review.mock.calls).toEqual([['status'], ['remove']]);
  expect(screen.getByRole('button', { name: 'Choose policy and review install' })).toBeEnabled();
});

it('discards arbitrary reply text and presents an unrecognized outcome as a fixed failure', async () => {
  const review = vi.fn().mockResolvedValue({
    success: true,
    code: 'PRIVATE_CANARY',
    error: 'SECRET_PATH',
    detail: 'SECRET_CONFIG',
  });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Profile review could not complete. Retained files are preserved.',
  );
  for (const value of ['PRIVATE_CANARY', 'SECRET_PATH', 'SECRET_CONFIG'])
    expect(screen.queryByText(value)).toBeNull();
});

it('keeps the simulated preview inert even with a host capability', () => {
  const review = vi.fn();
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host, preview: true });
  expect(screen.getByRole('button', { name: 'Choose policy and review install' })).toBeDisabled();
  expect(review).not.toHaveBeenCalled();
});

it.each(['ended', 'expired'])(
  'refreshes an earlier active status to %s and retains reports',
  async (status) => {
    const entry = {
      decision: 'ask',
      reason: 'project-review-ordinary',
      outcome: 'reported-completed',
    };
    const review = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        code: 'READY',
        canOpen: true,
        available: true,
        guardSession: snapshot('active', { entries: [entry] }),
      })
      .mockResolvedValueOnce({
        success: true,
        code: 'READY',
        canOpen: true,
        available: true,
        guardSession: snapshot(status),
      });
    render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
    expect(
      await screen.findByText(
        /Last successful check; current session status may have changed: Session listening/,
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
    expect(
      await screen.findByText(
        new RegExp(status === 'ended' ? 'Reporting session ended' : 'Session expired'),
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeDisabled();
    expect(
      screen.getByText('Retained reports are historical and may not describe the current session.'),
    ).toBeVisible();
    expect(screen.getByText(/Claimed provider result: tool completed/)).toHaveTextContent(
      'Effect unknown',
    );
  },
);

it('keeps the prior report historical after a failed refresh and allows an idempotent stop', async () => {
  const entry = { decision: 'deny', reason: 'project-deny-sensitive', outcome: 'reported-failed' };
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: snapshot('active', { entries: [entry], afterHooks: true }),
    })
    .mockRejectedValueOnce(Error('PRIVATE_ERROR'))
    .mockResolvedValueOnce({
      success: true,
      code: 'GUARD_STOPPED',
      canOpen: true,
      available: true,
      guardSession: snapshot('ended', { entries: [entry] }),
    });
  const { container } = render(ClaudeHookProfile, {
    host: { reviewClaudeHookProfile: review } as Host,
  });
  await screen.findByText(/Claimed provider result: tool failed/);
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
  expect(
    await screen.findByText(
      'Reporting session status is unavailable. Refresh setup status to try again.',
    ),
  ).toBeVisible();
  expect(
    screen.getByText('Retained reports are historical and may not describe the current session.'),
  ).toBeVisible();
  expect(screen.getByText(/Claimed provider result: tool failed/)).toHaveTextContent(
    'Effect unknown',
  );
  expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeEnabled();
  expect(container.textContent).not.toContain('PRIVATE_ERROR');
  await fireEvent.click(screen.getByRole('button', { name: 'Stop reporting' }));
  expect(await screen.findByText(/Reporting session ended/)).toBeVisible();
  expect(review.mock.calls).toEqual([['status'], ['status'], ['guard-stop']]);
});

it('preserves earlier reports without treating a malformed refresh as inactive', async () => {
  const entry = { decision: 'ask', reason: 'project-review-script', outcome: 'unknown' };
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: snapshot('active', { entries: [entry] }),
    })
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: { status: 'PRIVATE_UNRECOGNIZED' },
    });
  const { container } = render(ClaudeHookProfile, {
    host: { reviewClaudeHookProfile: review } as Host,
  });
  await screen.findByText(/Project script can run unchecked actions/);
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
  expect(
    await screen.findByText(
      'Reporting session status is unavailable. Refresh setup status to try again.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeEnabled();
  expect(screen.getByText(/Project script can run unchecked actions/)).toHaveTextContent(
    'Effect unknown',
  );
  expect(
    screen.getByText('Retained reports are historical and may not describe the current session.'),
  ).toBeVisible();
  expect(container.textContent).not.toContain('PRIVATE_UNRECOGNIZED');
});

it('does not offer new admission when native release is unconfirmed', async () => {
  const review = vi.fn().mockResolvedValue({
    success: true,
    code: 'GUARD_RELEASE_UNCONFIRMED',
    canOpen: true,
    available: true,
    guardSession: snapshot('refused'),
  });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(
    'The previous native reader did not confirm shutdown. Another reporting session is unavailable.',
  );
  expect(
    screen.getByText('Reporting session status is unavailable. Refresh setup status to try again.'),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeEnabled();
});

it('allows a safe stop after an initially malformed status', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: { status: 'PRIVATE_STATE' },
    })
    .mockResolvedValueOnce({
      success: true,
      code: 'GUARD_STOPPED',
      canOpen: true,
      available: true,
      guardSession: snapshot('ended'),
    });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText('Prepared setup files are available for native review.');
  expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Stop reporting' }));
  expect(await screen.findByText(/Reporting session ended/)).toBeVisible();
  expect(review.mock.calls).toEqual([['status'], ['guard-stop']]);
});

it('allows a safe stop if a previously inactive session becomes unknown', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: snapshot(),
    })
    .mockRejectedValueOnce(Error('private'))
    .mockResolvedValueOnce({
      success: true,
      code: 'GUARD_STOPPED',
      canOpen: true,
      available: true,
      guardSession: snapshot('ended'),
    });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(/No reporting session/);
  expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
  await screen.findByText(
    'Reporting session status is unavailable. Refresh setup status to try again.',
  );
  expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Stop reporting' }));
  expect(await screen.findByText(/Reporting session ended/)).toBeVisible();
  expect(review.mock.calls).toEqual([['status'], ['status'], ['guard-stop']]);
});

it.each([
  'WRITE_UNCERTAIN',
  'READBACK_FAILED',
  'POLICY_CREATE_UNCERTAIN',
  'POLICY_UNADOPTED',
  'RETAINED_UNKNOWN',
  'SESSION_RELEASE_UNCONFIRMED',
  'GUARD_RELEASE_UNCONFIRMED',
])('does not offer a new admission for retained outcome %s', async (code) => {
  const review = vi
    .fn()
    .mockResolvedValue({
      success: true,
      code,
      canOpen: true,
      available: true,
      guardSession: snapshot(),
    });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(/No reporting session/);
  expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Prepare with accepted project snapshot' }),
  ).toBeDisabled();
});

it.each([
  ['UNAVAILABLE', false],
  ['BUSY', true],
  ['READY', false],
  ['READY', undefined],
])(
  'requires ready service after %s with readiness %# and recovers on refresh',
  async (code, available) => {
    const review = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        code,
        available,
        canOpen: true,
        guardSession: snapshot(),
      })
      .mockResolvedValueOnce({
        success: true,
        code: 'READY',
        available: true,
        canOpen: true,
        guardSession: snapshot(),
      });
    render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
    await screen.findByText(
      code === 'UNAVAILABLE'
        ? 'Native setup files are unavailable or failed their integrity checks.'
        : code === 'BUSY'
          ? 'Another profile review is still in progress.'
          : 'Prepared setup files are available for native review.',
    );
    await screen.findByText(
      'Session preparation is unavailable until setup status is ready. Refresh to retry.',
    );
    expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Prepare with accepted project snapshot' }),
    ).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
    expect(await screen.findByRole('button', { name: 'Prepare terminal session' })).toBeEnabled();
  },
);

it('keeps Stop available for an active snapshot even when the service is not ready', async () => {
  const review = vi
    .fn()
    .mockResolvedValue({
      success: true,
      code: 'UNAVAILABLE',
      available: false,
      canOpen: true,
      guardSession: snapshot('active'),
    });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(
    'Session preparation is unavailable until setup status is ready. Refresh to retry.',
  );
  expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeEnabled();
});

it('retains the historical loss warning with earlier reports after an empty new snapshot', async () => {
  const entry = { decision: 'deny', reason: 'generic', outcome: 'unknown' };
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: snapshot('active', { lossDetected: true, entries: [entry] }),
    })
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: snapshot('ended'),
    });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(
    'Some reporting may have been lost or discarded; delivery remains unknown.',
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
  expect(
    await screen.findByText(
      'The retained historical reports may have lost or discarded entries; delivery remains unknown.',
    ),
  ).toBeVisible();
  expect(
    screen.queryByText('Some reporting may have been lost or discarded; delivery remains unknown.'),
  ).toBeNull();
  expect(screen.getByText(/DENY: Selected policy decision/)).toHaveTextContent('Effect unknown');
});

it.each([
  undefined,
  null,
  {},
  { status: 'PRIVATE_STATUS' },
  snapshot('inactive', { available: true }),
  snapshot('inactive', { entries: 'PRIVATE_ENTRIES' }),
  snapshot('inactive', { afterHooks: 'PRIVATE_BOOLEAN' }),
])(
  'fails closed for missing or malformed session state %# and permits retry',
  async (guardSession) => {
    const review = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        code: 'READY',
        canOpen: true,
        available: true,
        guardSession,
      })
      .mockResolvedValueOnce({
        success: true,
        code: 'READY',
        canOpen: true,
        available: true,
        guardSession: snapshot(),
      });
    const { container } = render(ClaudeHookProfile, {
      host: { reviewClaudeHookProfile: review } as Host,
    });
    await screen.findByText('Prepared setup files are available for native review.');
    expect(
      await screen.findByText(
        'Reporting session status is unavailable. Refresh setup status to try again.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/No reporting session/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Prepare with accepted project snapshot' }),
    ).toBeDisabled();
    expect(container.textContent).not.toMatch(/PRIVATE_STATUS|PRIVATE_ENTRIES|PRIVATE_BOOLEAN/);
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
    expect(await screen.findByText(/No reporting session/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeEnabled();
  },
);

it('serializes a pending admission with refresh and applies only the admitted result', async () => {
  let finish!: (value: unknown) => void;
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: snapshot(),
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(/No reporting session/);
  await fireEvent.click(screen.getByRole('button', { name: 'Prepare terminal session' }));
  expect(screen.getByText('Checking reporting session status…')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Refresh setup status' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
  expect(review.mock.calls).toEqual([['status'], ['guard-start']]);
  finish({
    success: true,
    code: 'GUARD_READY',
    canOpen: true,
    available: true,
    guardSession: snapshot('waiting'),
  });
  expect(await screen.findByText(/Waiting for the terminal broker/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Prepare terminal session' })).toBeDisabled();
});

it('does not allow a pending refresh to race a session mutation', async () => {
  let finish!: (value: unknown) => void;
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      canOpen: true,
      available: true,
      guardSession: snapshot('active'),
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(/Session listening/);
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh setup status' }));
  expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Stop reporting' }));
  expect(review.mock.calls).toEqual([['status'], ['status']]);
  finish({
    success: true,
    code: 'READY',
    canOpen: true,
    available: true,
    guardSession: snapshot('ended'),
  });
  expect(await screen.findByText(/Reporting session ended/)).toBeVisible();
});

it('does not apply an old pending refresh to a remounted profile', async () => {
  let finish!: (value: unknown) => void;
  const oldReview = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: oldReview } as Host });
  old.unmount();
  const review = vi.fn().mockResolvedValue({
    success: true,
    code: 'READY',
    canOpen: true,
    available: true,
    guardSession: snapshot('ended'),
  });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(/Reporting session ended/);
  finish({
    success: true,
    code: 'READY',
    canOpen: true,
    available: true,
    guardSession: snapshot('active'),
  });
  expect(screen.queryByText(/Session listening/)).toBeNull();
  expect(screen.getByText(/Reporting session ended/)).toBeVisible();
});

it('translates historical and unavailable session status in Portuguese', async () => {
  language.set('pt');
  try {
    const review = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        code: 'READY',
        canOpen: true,
        available: true,
        guardSession: snapshot('active'),
      })
      .mockRejectedValueOnce(Error('private'));
    render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
    expect(
      await screen.findByText(
        /Última verificação bem-sucedida; o estado atual da sessão pode ter mudado/,
      ),
    ).toBeVisible();
    await fireEvent.click(screen.getByRole('button', { name: 'Atualizar estado da configuração' }));
    expect(
      await screen.findByText(
        'O estado da sessão de relatórios está indisponível. Atualize o estado da configuração para tentar novamente.',
      ),
    ).toBeVisible();
  } finally {
    language.set('en');
  }
});

it('shows only fixed reported decisions and keeps sender, delivery and effect unverified', async () => {
  const review = vi.fn().mockResolvedValue({
    success: true,
    code: 'READY',
    canOpen: true,
    available: true,
    guardSession: {
      ...snapshot('active'),
      status: 'active',
      available: true,
      lossDetected: true,
      entries: [
        { decision: 'deny', reason: 'project-deny-sensitive', command: 'PRIVATE_COMMAND' },
        { decision: 'ask', reason: 'project-review-ordinary' },
        { decision: 'ask', reason: 'project-review-script' },
        { decision: 'SECRET_DECISION', reason: 'generic' },
        { decision: 'allow', reason: 'project-deny-sensitive' },
      ],
      token: 'PRIVATE_TOKEN',
    },
  });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(
    /Last successful check; current session status may have changed: Session listening; delivery remains unknown/,
  );
  expect(
    screen.getByText(
      'DENY: Declared sensitive filename · Provider result unknown · Effect unknown',
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      'ASK: Provider confirmation requested for supported command · Provider result unknown · Effect unknown',
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      'ASK: Project script can run unchecked actions; provider confirmation requested · Provider result unknown · Effect unknown',
    ),
  ).toBeVisible();
  expect(
    screen.getByText('Some reporting may have been lost or discarded; delivery remains unknown.'),
  ).toBeVisible();
  expect(
    screen.getByText(
      'After-result hooks were not verified at the last successful check; delivery remains unknown.',
    ),
  ).toBeVisible();
  expect(screen.queryByText('PRIVATE_COMMAND')).toBeNull();
  expect(screen.queryByText('PRIVATE_TOKEN')).toBeNull();
  expect(screen.queryByText('SECRET_DECISION')).toBeNull();
  expect(screen.queryByText(/ALLOW: Declared sensitive filename/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeEnabled();
});

it('shows only bounded provider-reported results and keeps missing or malformed outcomes unknown', async () => {
  const review = vi.fn().mockResolvedValue({
    success: true,
    code: 'READY',
    guardSession: {
      ...snapshot('active'),
      status: 'active',
      afterHooks: true,
      entries: [
        { decision: 'ask', reason: 'project-review-ordinary', outcome: 'reported-completed' },
        { decision: 'deny', reason: 'project-deny-sensitive', outcome: 'reported-failed' },
        { decision: 'allow', reason: 'generic' },
        { decision: 'ask', reason: 'project-review-script', outcome: 'PRIVATE_OUTCOME' },
        { decision: 'ask', reason: 'project-review-edit', outcome: { text: 'PRIVATE_RESPONSE' } },
      ],
    },
  });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  expect(await screen.findByText(/Claimed provider result: tool completed/)).toHaveTextContent(
    'Effect unknown',
  );
  expect(
    screen.getByText(
      'At the last successful check, after-result hooks were verified in the selected profile; current status may have changed and delivery remains unknown.',
    ),
  ).toBeVisible();
  expect(screen.getByText(/Claimed provider result: tool failed/)).toHaveTextContent(
    'Effect unknown',
  );
  expect(screen.getAllByText(/Provider result unknown/)).toHaveLength(3);
  expect(screen.queryByText('PRIVATE_OUTCOME')).toBeNull();
  expect(screen.queryByText('PRIVATE_RESPONSE')).toBeNull();
});

it('retains historical admission without claiming the stopped profile is currently verified', async () => {
  const entry = { decision: 'allow', reason: 'generic', outcome: 'reported-completed' };
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'READY',
      guardSession: {
        ...snapshot('active'),
        status: 'active',
        afterHooks: true,
        afterHooksAtAdmission: true,
        entries: [entry],
      },
    })
    .mockResolvedValueOnce({
      success: true,
      code: 'GUARD_STOPPED',
      guardSession: {
        ...snapshot('ended'),
        status: 'ended',
        afterHooks: false,
        afterHooksAtAdmission: true,
        entries: [entry],
      },
    });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(/Claimed provider result: tool completed/);
  await fireEvent.click(screen.getByRole('button', { name: 'Stop reporting' }));
  expect(
    await screen.findByText(
      'After-result hooks were verified at admission; current profile verification is unknown.',
    ),
  ).toBeVisible();
  expect(screen.getByText(/Claimed provider result: tool completed/)).toHaveTextContent(
    'Effect unknown',
  );
  expect(review.mock.calls).toEqual([['status'], ['guard-stop']]);
});

it('keeps an unqualified legacy after group unverified even when a claim arrives', async () => {
  const review = vi.fn().mockResolvedValue({
    success: true,
    code: 'READY',
    guardSession: {
      ...snapshot('active'),
      status: 'active',
      afterHooks: false,
      afterHooksAtAdmission: false,
      entries: [{ decision: 'allow', reason: 'generic', outcome: 'reported-completed' }],
    },
  });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  expect(
    await screen.findByText(
      'After-result hooks were not verified at the last successful check; delivery remains unknown.',
    ),
  ).toBeVisible();
  expect(screen.getByText(/Claimed provider result: tool completed/)).toHaveTextContent(
    'Effect unknown',
  );
});

it('explains the selected launch route and its unverified failure boundary', () => {
  render(ClaudeHookProfile, { host: null, preview: true });
  expect(screen.getByText(/copy the folder path from the Explorer address bar/)).toBeVisible();
  expect(screen.getByText(/Claude behavior when a hook is missing/)).toHaveTextContent(
    'has not been qualified',
  );
  expect(screen.getByText(/Other tools and launches without the profile/)).toBeVisible();
  expect(screen.getByText(/If Claude invokes the hook/)).toBeVisible();
  expect(screen.getByText(/claude --settings \$settings/)).toBeVisible();
  expect(
    screen.getByText('This direct route does not send decision reports to AEGIS.'),
  ).toBeVisible();
});
