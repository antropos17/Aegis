/**
 * command-registry.test.ts — Structural tests for static command registry
 */
import { describe, it, expect } from 'vitest';
import {
  getAllCommands,
  getNavigationCommands,
  getThemeCommands,
  getExportCommands,
  getActionCommands,
} from '../../src/renderer/lib/utils/command-registry';
import type { CommandCategory } from '../../src/shared/types';

const VALID_CATEGORIES: CommandCategory[] = ['navigate', 'theme', 'export', 'action'];

describe('command-registry', () => {
  describe('getAllCommands', () => {
    it('returns 22 commands total', () => {
      expect(getAllCommands()).toHaveLength(22);
    });

    it('every command has id, label, and category', () => {
      for (const cmd of getAllCommands()) {
        expect(cmd.id).toBeTruthy();
        expect(cmd.label).toBeTruthy();
        expect(cmd.category).toBeTruthy();
      }
    });

    it('has no duplicate ids', () => {
      const ids = getAllCommands().map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all categories are valid', () => {
      for (const cmd of getAllCommands()) {
        expect(VALID_CATEGORIES).toContain(cmd.category);
      }
    });
  });

  describe('getNavigationCommands', () => {
    it('returns 7 items (5 tabs + settings + search)', () => {
      expect(getNavigationCommands()).toHaveLength(7);
    });

    it('all have category "navigate"', () => {
      for (const cmd of getNavigationCommands()) {
        expect(cmd.category).toBe('navigate');
      }
    });
  });

  describe('getThemeCommands', () => {
    it('returns 5 items', () => {
      expect(getThemeCommands()).toHaveLength(5);
    });

    it('all have category "theme"', () => {
      for (const cmd of getThemeCommands()) {
        expect(cmd.category).toBe('theme');
      }
    });
  });

  describe('getExportCommands', () => {
    it('returns 7 items', () => {
      expect(getExportCommands()).toHaveLength(7);
    });

    it('all have category "export"', () => {
      for (const cmd of getExportCommands()) {
        expect(cmd.category).toBe('export');
      }
    });
  });

  describe('getActionCommands', () => {
    it('returns 3 items', () => {
      expect(getActionCommands()).toHaveLength(3);
    });

    it('all have category "action"', () => {
      for (const cmd of getActionCommands()) {
        expect(cmd.category).toBe('action');
      }
    });
  });
});
