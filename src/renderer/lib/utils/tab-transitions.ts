/**
 * Tab transition utilities for directional slide + fade animations.
 * Computes slide direction based on tab index ordering.
 * @module tab-transitions
 */

/** Ordered tab IDs — index determines slide direction */
const TAB_ORDER: readonly string[] = ['shield', 'activity', 'rules', 'reports', 'stats'];

/**
 * Returns the index of a tab ID in the ordered list.
 * @param tabId - The tab identifier
 * @returns Index position (0-based), or -1 if not found
 */
export function getTabIndex(tabId: string): number {
  return TAB_ORDER.indexOf(tabId);
}

/**
 * Determines slide direction when switching tabs.
 * @param fromTab - Previous active tab ID
 * @param toTab - New active tab ID
 * @returns 1 for left-to-right (slide from right), -1 for right-to-left (slide from left)
 */
export function getSlideDirection(fromTab: string, toTab: string): 1 | -1 {
  const fromIdx = getTabIndex(fromTab);
  const toIdx = getTabIndex(toTab);
  return toIdx >= fromIdx ? 1 : -1;
}

/** Slide offset in pixels for tab content transition */
export const SLIDE_OFFSET_PX = 24;

/** Transition duration in milliseconds */
export const TRANSITION_DURATION_MS = 220;
