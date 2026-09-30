const observationStates: Readonly<Record<string, string>> = {
  BOOTING: 'Starting AEGIS',
  SENSORS_STARTING: 'Sensors starting',
  HEALTHY: 'Observation healthy',
  DEGRADED: 'Observation limited',
  FAILED: 'Observation unavailable',
};

/** Describe the observed app health without claiming enforcement coverage.
 * @param state Main-process health state, or an unavailable observation
 * @returns Localization key for the observation status
 * @since 0.17.0
 */
export function observationStatusLabel(state: unknown): string {
  return typeof state === 'string' && Object.hasOwn(observationStates, state)
    ? observationStates[state]
    : 'Observation unknown';
}
