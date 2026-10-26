import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SettingsMonitoring from '../../../frontend/observatory/components/SettingsMonitoring.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';
const mount = (host: Host | null) =>
  render(SettingsMonitoring, {
    host,
    form: { scanIntervalSec: 10, notificationsEnabled: true, ignoreCommonBuildDirs: true },
    patterns: '',
    ignored: '',
    patternInput: undefined,
  });
it('selects and clears through fixed native operations without sending a folder path', async () => {
  const control = vi
    .fn()
    .mockResolvedValueOnce({ success: true, code: 'UNSELECTED', selected: false })
    .mockResolvedValueOnce({ success: true, code: 'SELECTED', selected: true })
    .mockResolvedValueOnce({ success: true, code: 'UNSELECTED', selected: false });
  mount({ controlProjectWatch: control } as Host);
  await screen.findByText('No external project folder is selected.');
  expect(screen.getByRole('button', { name: 'Clear project folder' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Choose project folder' }));
  await screen.findByText('A project folder is selected. Check Monitoring for live coverage.');
  await fireEvent.click(screen.getByRole('button', { name: 'Clear project folder' }));
  await screen.findByText('No external project folder is selected.');
  expect(control.mock.calls).toEqual([['status'], ['select'], ['clear']]);
});
it('renders only a fixed unavailable outcome and discards arbitrary backend text', async () => {
  const control = vi.fn().mockResolvedValue({
    success: true,
    code: 'PRIVATE_ROOT_CANARY',
    path: 'PRIVATE_PATH',
    error: 'PRIVATE_ERROR',
  });
  mount({ controlProjectWatch: control } as Host);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The private folder selection could not be saved. The previous selection is retained.',
  );
  expect(screen.queryByText(/PRIVATE/)).toBeNull();
});
it('requires the desktop capability and ignores late completion after the panel unmounts', async () => {
  const first = mount(null);
  expect(screen.getByRole('button', { name: 'Choose project folder' })).toBeDisabled();
  first.unmount();
  let finish: (value: unknown) => void = () => {};
  const control = vi
    .fn()
    .mockResolvedValueOnce({ success: true, code: 'UNSELECTED', selected: false })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const component = mount({ controlProjectWatch: control } as Host);
  await screen.findByText('No external project folder is selected.');
  await fireEvent.click(screen.getByRole('button', { name: 'Choose project folder' }));
  expect(screen.getByRole('button', { name: 'Choose project folder' })).toBeDisabled();
  component.unmount();
  finish({ success: true, code: 'SELECTED', selected: true });
  await Promise.resolve();
  expect(control.mock.calls).toEqual([['status'], ['select']]);
});
