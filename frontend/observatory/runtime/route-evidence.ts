import type { ActionCheck } from './action-coverage';
import type { RouteObservation } from './action-observation';

export type RouteEvidence = {
  inputs: 'unchecked' | 'captured';
  owner: 'unobserved' | 'waiting' | 'live' | 'past' | 'ended-before-client';
  call: 'unobserved' | 'waiting' | 'none-live' | 'reached-live' | 'none-past' | 'reached-past';
  relation: 'unavailable' | 'matching-labels' | 'mismatched-labels' | 'no-delete-preflight';
  checked: {
    kind: ActionCheck['kind'];
    route: ActionCheck['route'];
    configuration: ActionCheck['report']['configuration'];
    at: string;
  } | null;
  connected: {
    route: NonNullable<RouteObservation['snapshot']>['route'];
    selection: NonNullable<RouteObservation['snapshot']>['selection'];
    ownerInvocations: number;
    lastReceivedAt: string | null;
  } | null;
};

/** Summarize separate captured and connection evidence without treating matching labels as a binding.
 * @param check Validated retained action check, if any.
 * @param observation Validated current route observation, if any.
 * @returns Evidence states for the current connection only. @since 0.16.0 */
export function summarizeRouteEvidence(
  check: ActionCheck | null,
  observation: RouteObservation | null,
): RouteEvidence {
  const checked = check
    ? {
        kind: check.kind,
        route: check.route,
        configuration: check.report.configuration,
        at: check.createdAt,
      }
    : null;
  const snapshot = observation?.snapshot ?? null;
  const live = observation?.state === 'observed' && snapshot?.state === 'observed';
  const ended =
    observation?.state === 'coverage-lost' ||
    observation?.state === 'stopped' ||
    observation?.state === 'unavailable';
  const past = ended && snapshot?.state !== 'awaiting-client' && !!snapshot;
  // A new connecting/awaiting generation must never inherit the prior owner's counters.
  const connected =
    (live || past) && snapshot
      ? {
          route: snapshot.route,
          selection: snapshot.selection,
          ownerInvocations: snapshot.ownerInvocations,
          lastReceivedAt: observation?.lastObservedAt ?? null,
        }
      : null;
  const owner: RouteEvidence['owner'] = live
    ? 'live'
    : past
      ? 'past'
      : ended && snapshot
        ? 'ended-before-client'
        : observation?.state === 'connecting' || observation?.state === 'awaiting-client'
          ? 'waiting'
          : 'unobserved';
  const call: RouteEvidence['call'] = connected
    ? connected.ownerInvocations > 0
      ? live
        ? 'reached-live'
        : 'reached-past'
      : live
        ? 'none-live'
        : 'none-past'
    : owner === 'waiting'
      ? 'waiting'
      : 'unobserved';
  const relation: RouteEvidence['relation'] = !connected
    ? 'unavailable'
    : connected.selection === 'selected-file-delete'
      ? 'no-delete-preflight'
      : !checked
        ? 'unavailable'
        : checked.route === connected.route &&
            (checked.kind === 'catalog' ? 'catalog' : 'single-action') === connected.selection
          ? 'matching-labels'
          : 'mismatched-labels';
  return {
    inputs: checked ? 'captured' : 'unchecked',
    owner,
    call,
    relation,
    checked,
    connected,
  };
}
