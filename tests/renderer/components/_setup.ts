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
