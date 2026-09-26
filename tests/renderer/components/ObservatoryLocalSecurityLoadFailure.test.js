import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import { createPreviewHost } from '../../../frontend/observatory/demo/host';

vi.mock('../../../frontend/observatory/components/LocalSecurity.svelte', () => {
  throw new Error('fixture module request failed with a private path');
});

afterEach(() => localStorage.clear());

it('gives a fixed recovery action when the local review module cannot load', async () => {
  render(App, { host: createPreviewHost(), preview: true });
  await fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', {
      name: 'Local security',
    }),
  );
  const alert = await screen.findByRole(
    'alert',
    { name: 'Local security could not be loaded' },
    { timeout: 5000 },
  );
  expect(alert).toHaveTextContent('Reload the app to try again.');
  expect(within(alert).getByRole('button', { name: 'Reload app' })).toBeVisible();
  expect(alert).not.toHaveTextContent('private path');
});
