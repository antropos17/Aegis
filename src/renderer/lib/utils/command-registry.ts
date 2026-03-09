/**
 * @file command-registry.ts — Static command definitions for Command Palette
 * @module renderer/lib/utils/command-registry
 * @description Provides all static commands grouped by category.
 * Agent commands (107) are excluded — loaded dynamically via fuzzy search.
 */

import type { CommandItem } from '../../../shared/types/command-palette';

/** Navigation commands: 5 tabs + settings toggle + search focus */
export function getNavigationCommands(): CommandItem[] {
  return [
    {
      id: 'nav:shield',
      label: 'Go to Shield',
      category: 'navigate',
      icon: '🛡️',
      shortcut: '1',
      keywords: ['dashboard', 'home', 'overview'],
    },
    {
      id: 'nav:activity',
      label: 'Go to Activity',
      category: 'navigate',
      icon: '📋',
      shortcut: '2',
      keywords: ['events', 'feed', 'log'],
    },
    {
      id: 'nav:rules',
      label: 'Go to Rules',
      category: 'navigate',
      icon: '📐',
      shortcut: '3',
      keywords: ['patterns', 'sensitive', 'config'],
    },
    {
      id: 'nav:reports',
      label: 'Go to Reports',
      category: 'navigate',
      icon: '📊',
      shortcut: '4',
      keywords: ['audit', 'summary'],
    },
    {
      id: 'nav:stats',
      label: 'Go to Stats',
      category: 'navigate',
      icon: '📈',
      shortcut: '5',
      keywords: ['metrics', 'charts', 'performance'],
    },
    {
      id: 'nav:settings',
      label: 'Toggle Settings',
      category: 'navigate',
      icon: '⚙️',
      shortcut: 'S',
      keywords: ['preferences', 'options'],
    },
    {
      id: 'nav:search',
      label: 'Focus Search',
      category: 'navigate',
      icon: '🔍',
      shortcut: '/',
      keywords: ['find', 'filter'],
    },
  ];
}

/** Theme switching commands */
export function getThemeCommands(): CommandItem[] {
  return [
    {
      id: 'theme:toggle',
      label: 'Toggle Theme',
      category: 'theme',
      icon: '🎨',
      shortcut: 'T',
      keywords: ['dark', 'light', 'switch'],
    },
    { id: 'theme:dark', label: 'Dark Theme', category: 'theme', icon: '🌙', keywords: ['night'] },
    {
      id: 'theme:light',
      label: 'Light Theme',
      category: 'theme',
      icon: '☀️',
      keywords: ['day', 'bright'],
    },
    {
      id: 'theme:dark-hc',
      label: 'Dark High Contrast',
      category: 'theme',
      icon: '🌑',
      keywords: ['accessibility', 'a11y'],
    },
    {
      id: 'theme:light-hc',
      label: 'Light High Contrast',
      category: 'theme',
      icon: '🌕',
      keywords: ['accessibility', 'a11y'],
    },
  ];
}

/** Export / download commands */
export function getExportCommands(): CommandItem[] {
  return [
    {
      id: 'export:json',
      label: 'Export JSON',
      category: 'export',
      icon: '📄',
      keywords: ['download', 'save'],
    },
    {
      id: 'export:csv',
      label: 'Export CSV',
      category: 'export',
      icon: '📊',
      keywords: ['spreadsheet', 'table'],
    },
    {
      id: 'export:html',
      label: 'Export HTML',
      category: 'export',
      icon: '🌐',
      keywords: ['report', 'web'],
    },
    {
      id: 'export:zip',
      label: 'Export ZIP',
      category: 'export',
      icon: '📦',
      keywords: ['archive', 'bundle'],
    },
    {
      id: 'export:audit',
      label: 'Full Audit',
      category: 'export',
      icon: '🔒',
      keywords: ['complete', 'security'],
    },
    {
      id: 'export:config',
      label: 'Export Config',
      category: 'export',
      icon: '⚙️',
      keywords: ['settings', 'preferences'],
    },
    {
      id: 'export:agent-db',
      label: 'Export Agent DB',
      category: 'export',
      icon: '🤖',
      keywords: ['database', 'agents', 'signatures'],
    },
  ];
}

/** Miscellaneous action commands */
export function getActionCommands(): CommandItem[] {
  return [
    {
      id: 'action:test-notification',
      label: 'Test Notification',
      category: 'action',
      icon: '🔔',
      keywords: ['alert', 'toast'],
    },
    {
      id: 'action:analyze-session',
      label: 'Analyze Session',
      category: 'action',
      icon: '🔬',
      keywords: ['scan', 'inspect', 'review'],
    },
    {
      id: 'action:toggle-demo',
      label: 'Toggle Demo Mode',
      category: 'action',
      icon: '🎭',
      keywords: ['sample', 'fake', 'mock'],
    },
  ];
}

/** All static commands combined (excludes dynamic agent commands) */
export function getAllCommands(): CommandItem[] {
  return [
    ...getNavigationCommands(),
    ...getThemeCommands(),
    ...getExportCommands(),
    ...getActionCommands(),
  ];
}
