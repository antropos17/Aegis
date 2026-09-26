import { record, type Telemetry } from './host';

export type NetworkSnapshotStatus = 'latest' | 'retained' | 'unavailable';

/** Classify network rows by their own delivery and sensor state.
 * @param telemetry Current telemetry @param rowCount Rows shown by the view
 * @returns Snapshot availability for display @since 0.16.0
 */
export function networkSnapshotStatus(
  telemetry: Telemetry,
  rowCount = telemetry.network.length,
): NetworkSnapshotStatus {
  const sensor = record(record(record(record(telemetry.stats.appHealth).sensors).byId).network);
  const delivered =
    typeof telemetry.networkAt === 'number' &&
    Number.isFinite(telemetry.networkAt) &&
    telemetry.networkAt > 0;
  if (
    telemetry.ready &&
    !telemetry.stale &&
    delivered &&
    (!sensor.state || sensor.state === 'HEALTHY')
  )
    return 'latest';
  return rowCount > 0 ? 'retained' : 'unavailable';
}
