import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import { createPreviewHost } from '../../../frontend/observatory/demo/host';

const moduleLoad = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../frontend/observatory/components/LocalSecurity.svelte', async (importOriginal) => {
  moduleLoad.count++;
  await new Promise((resolve) => setTimeout(resolve, 200));
  return importOriginal();
});

afterEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

const navigation = () => within(screen.getByRole('navigation', { name: 'Main navigation' }));

it('loads the local review on first visit and retains its setup and result across workspaces', async () => {
  render(App, { host: createPreviewHost(), preview: true });
  expect(moduleLoad.count).toBe(0);
  await fireEvent.click(navigation().getByRole('button', { name: 'Local security' }));
  expect(screen.getByRole('status', { name: 'Loading local security' })).toBeVisible();
  expect(
    await screen.findByRole('heading', { name: 'Start with a project folder' }, { timeout: 5000 }),
  ).toBeVisible();
  expect(moduleLoad.count).toBe(1);

  await fireEvent.click(screen.getByText('Review options', { exact: true }));
  const includeTools = screen.getByLabelText('Include an offline MCP tools/list file');
  await fireEvent.click(includeTools);
  await fireEvent.click(screen.getByRole('button', { name: 'Show example result' }));
  expect(await screen.findByText('Simulated review loaded. No files were read.')).toBeVisible();

  await fireEvent.click(navigation().getByRole('button', { name: 'Monitoring' }));
  await fireEvent.click(navigation().getByRole('button', { name: 'Local security' }));
  expect(screen.getByLabelText('Include an offline MCP tools/list file')).toBe(includeTools);
  expect(includeTools).toBeChecked();
  expect(screen.getByText('Simulated review loaded. No files were read.')).toBeVisible();
  expect(moduleLoad.count).toBe(1);
}, 15000);

it('opens a direct Local security link through the same review workspace', async () => {
  window.history.replaceState({}, '', '/?view=local-security');
  render(App, { host: createPreviewHost(), preview: true });
  expect(
    await screen.findByRole('heading', { name: 'Start with a project folder' }, { timeout: 5000 }),
  ).toBeVisible();
  expect(navigation().getByRole('button', { name: 'Local security' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
