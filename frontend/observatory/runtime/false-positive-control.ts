import type { FalsePositiveEntry } from '../../../src/shared/types';
import { matchesFalsePositive } from '../../../src/shared/false-positive-match.js';
import { confirmed, invoke, record, type Host, type RecordData } from './host';
import { falsePositivePopulation } from './false-positive-population';

export interface ExactExceptionTarget {
  readonly agentName: string;
  readonly file: string;
  readonly pattern: string;
}
export interface ExactExceptionStatus {
  readonly muted: boolean;
  readonly excluded: boolean;
}
const writes = new WeakMap<Host, Promise<unknown>>();

/** Select only full-path evidence with an observed agent label.
 * @param row Selected evidence, without a current-agent fallback
 * @returns Exact saved-pattern target or null for an unattributed/summary row
 * @since 0.19.2
 */
export function exactExceptionTarget(row: RecordData): ExactExceptionTarget | null {
  if (
    typeof row.agent !== 'string' ||
    !row.agent ||
    typeof row.file !== 'string' ||
    !/^(?:\/|[a-z]:[/\\]|\\\\)/i.test(row.file) ||
    row.attribution === 'unattributed' ||
    record(row.attribution).status === 'unattributed'
  )
    return null;
  return {
    agentName: row.agent,
    file: row.file,
    pattern: `^${row.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
  };
}

function exactEntry(entry: FalsePositiveEntry, target: ExactExceptionTarget): boolean {
  return entry.agentName === target.agentName && entry.pattern === target.pattern;
}
function status(entries: FalsePositiveEntry[], target: ExactExceptionTarget): ExactExceptionStatus {
  return {
    muted: entries.some((entry) => exactEntry(entry, target)),
    excluded: matchesFalsePositive({ agent: target.agentName, file: target.file }, entries),
  };
}
async function population(host: Host | null): Promise<FalsePositiveEntry[]> {
  return falsePositivePopulation(await invoke(host, 'getFalsePositives'));
}

/** Read confirmed status; no saved population is inferred from telemetry or errors.
 * @param host Desktop bridge @param target Exact selected evidence
 * @returns Confirmed exact-entry and existing-pattern status @since 0.19.2
 */
export async function readExactException(
  host: Host | null,
  target: ExactExceptionTarget,
): Promise<ExactExceptionStatus> {
  return status(await population(host), target);
}

export class ExceptionReadbackError extends Error {}

/** Serialize exception changes and undo only the exact entry from the latest population.
 * @param host Desktop bridge @param target Captured agent/file target
 * @param muted Desired exact-entry state @param refresh Refresh the saved scoring population
 * @returns Readback-confirmed state; a readback error requires read-only recovery
 * @since 0.19.2
 */
export async function changeExactException(
  host: Host,
  target: ExactExceptionTarget,
  muted: boolean,
  refresh: () => Promise<void>,
): Promise<ExactExceptionStatus> {
  const previous = writes.get(host) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const latest = await population(host);
      if (status(latest, target).muted !== muted) {
        if (muted)
          confirmed(
            await invoke(host, 'addFalsePositive', {
              agentName: target.agentName,
              pattern: target.pattern,
              timestamp: Date.now(),
            }),
          );
        else
          confirmed(
            await invoke(
              host,
              'saveSettings',
              {
                falsePositivePatterns: latest.filter((entry) => !exactEntry(entry, target)),
              },
              { patch: true },
            ),
          );
      }
      try {
        const result = await readExactException(host, target);
        if (result.muted !== muted) throw new Error('Saved exception status changed');
        await refresh();
        return result;
      } catch {
        throw new ExceptionReadbackError('Exception status could not be verified. Retry status.');
      }
    });
  writes.set(host, operation);
  try {
    return await operation;
  } finally {
    if (writes.get(host) === operation) writes.delete(host);
  }
}
