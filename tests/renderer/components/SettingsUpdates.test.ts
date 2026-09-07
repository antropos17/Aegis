import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import SettingsUpdates from '../../../src/renderer/lib/components/SettingsUpdates.svelte';
import UpdateNotice from '../../../src/renderer/lib/components/UpdateNotice.svelte';
import { updateStatus } from '../../../src/renderer/lib/stores/updates';

afterEach(() => {
  cleanup();
  delete window.aegis;
});

describe('update controls', () => {
  it('renders release notes as text and separates downloading from installation', async () => {
    // Deliberately narrow bridge: this panel must not require unrelated privileges.
    Object.defineProperty(window, 'aegis', {
      configurable: true,
      value: {
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        installUpdate: vi.fn(),
      },
    });
    updateStatus.set({
      status: 'available',
      version: '0.15.0-alpha',
      notes: '<img src=x onerror=alert(1)>',
      progress: 0,
      error: null,
    });
    const { container } = render(SettingsUpdates);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain('<img');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    expect(window.aegis?.downloadUpdate).toHaveBeenCalledOnce();
    expect(window.aegis?.installUpdate).not.toHaveBeenCalled();
    updateStatus.update((s) => ({ ...s, status: 'downloading', progress: 50 }));
    await tick();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Restart and install' })).toBeNull();
    updateStatus.update((s) => ({ ...s, status: 'ready', progress: 100 }));
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Restart and install' }));
    expect(window.aegis?.installUpdate).toHaveBeenCalledOnce();
  });

  it('routes the dashboard notice to review and hides it when no update exists', async () => {
    updateStatus.set({
      status: 'ready',
      version: '0.15.0-alpha',
      notes: '',
      progress: 100,
      error: null,
    });
    const onOpen = vi.fn();
    render(UpdateNotice, { props: { onOpen } });
    await fireEvent.click(screen.getByRole('button', { name: 'Review update' }));
    expect(onOpen).toHaveBeenCalledOnce();
    updateStatus.update((s) => ({ ...s, status: 'up-to-date' }));
    await tick();
    expect(screen.queryByRole('button', { name: 'Review update' })).toBeNull();
  });
});
