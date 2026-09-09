/**
 * _setup.ts — Global setup for Svelte component tests.
 * Registers jest-dom matchers and auto-cleans DOM after each test.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom does not implement native dialog top-layer methods. Real focus trapping
// and Escape behavior are exercised by the browser and Electron checks.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
}
