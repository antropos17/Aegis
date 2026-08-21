/**
 * @file app-health.ts — app-level health payload carried on the stats surfaces
 * @module shared/types/app-health
 * @description The typed mirror of `src/main/app-health.js`. Both halves of each
 *   closed list are compared in declaration order by
 *   `tests/main/app-health-types.test.js` — `tsc` cannot see a runtime object and the
 *   runtime cannot see a union, so nothing else connects them.
 */

/**
 * App-level state. Mirrors `APP_HEALTH_STATE`.
 *
 * Not a worst-of roll-up over the sensors: `FAILED` says a core observation CAPABILITY
 * is unavailable, and its only live route is a failed process-population enumeration.
 * A single sensor in FAILED reaches `DEGRADED`.
 */
export type AppHealthState = 'BOOTING' | 'SENSORS_STARTING' | 'HEALTHY' | 'DEGRADED' | 'FAILED';

/**
 * Reason codes. Mirrors `APP_HEALTH_REASON`, in declaration order.
 *
 * The COMPLETE set of satisfied conditions, not just the winning rule's — so
 * `population-failed` and `sensor-failed` legitimately co-occur when the `process` leaf
 * is both. These are reason codes, NOT sensor identifiers: a reader that wants sensor
 * names takes them from {@link SensorHealthAggregate.failedSensorIds} /
 * `degradedSensorIds`.
 */
export type AppHealthReason =
  | 'population-failed'
  | 'population-degraded'
  | 'population-starting'
  | 'zero-coverage'
  | 'sensor-failed'
  | 'sensor-degraded'
  | 'sensor-starting'
  | 'identity-degraded'
  | 'watch-roots-unavailable'
  | 'watch-plan-starting'
  | 'residual-loss';

/** Per-sensor leaf state. Mirrors `SENSOR_HEALTH_STATE` in `sensor-health.js`. */
export type SensorHealthState =
  | 'STARTING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'FAILED'
  | 'DISABLED'
  | 'UNSUPPORTED';

/**
 * One sensor's health record, exactly as the owning module publishes it.
 *
 * `lossCount` is cumulative for the record's lifetime and is NEVER cleared by a later
 * success — a leaf carrying loss reports DEGRADED however well the last attempt went.
 */
export interface SensorHealth {
  readonly sensorId: string;
  readonly state: SensorHealthState;
  /** ms epoch when the latest result was applied. */
  readonly lastAttemptAt: number | null;
  /** ms epoch of the last fully successful observation. How old the reading is. */
  readonly lastSuccessAt: number | null;
  readonly lastError: string | null;
  /** Full failures only; a DEGRADED partial does not increment it. */
  readonly consecutiveFailures: number;
  readonly lossCount: number;
  readonly detail: string | null;
}

/** Worst-of over the participating leaves. DISABLED and UNSUPPORTED do not participate. */
export interface SensorHealthAggregate {
  /** Worst participating state, or `'NONE'` when nothing participates. */
  readonly state: SensorHealthState | 'NONE';
  readonly participatingCount: number;
  readonly totalCount: number;
  readonly failedSensorIds: string[];
  readonly degradedSensorIds: string[];
}

/** One record the effective projection rewrote, published so the rewrite is auditable. */
export interface AppHealthProjection {
  readonly sensorId: string;
  readonly from: SensorHealthState;
  readonly to: SensorHealthState;
  readonly reason: string;
}

/**
 * The sensor evidence behind {@link AppHealth.state}.
 *
 * `byId` and `raw` are the UNTOUCHED records; `effective` is the set the state rests
 * on. They differ by exactly the entries listed in `projections` — today only an
 * accepted CIM birth-time fallback on `proc-snapshot`, which is real degradation of the
 * SOURCE and not of the application.
 */
export interface AppHealthSensors {
  readonly byId: Readonly<Record<string, SensorHealth>>;
  readonly raw: SensorHealthAggregate | null;
  readonly effective: SensorHealthAggregate | null;
  readonly projections: AppHealthProjection[];
}

/** The chokidar watch plane, as `file-watcher.getWatchPlan()` reports it. */
export interface AppHealthWatchPlan {
  readonly state: SensorHealthState;
  /** FAILED means this is zero: no live watcher object exists at all. */
  readonly liveWatcherCount: number;
  readonly unavailableGroups: ReadonlyArray<{ id: string; state: string; reason: string }>;
}

/**
 * The `appHealth` block of `getStats()`, carried on `get-stats`, `stats-update` and
 * `scan-batch.stats`. No channel of its own.
 *
 * `monitoringPaused` is NOT part of this shape. Operator control is a separate
 * dimension and rides beside it as `stats.monitoringPaused`; folding a deliberate
 * silence into a health enum would make it indistinguishable from a broken sensor.
 */
export interface AppHealth {
  readonly state: AppHealthState;
  /** Every satisfied condition, in {@link AppHealthReason} declaration order. */
  readonly reasons: AppHealthReason[];
  /**
   * The `process` leaf's state. Null only while BOOTING, where no record exists yet —
   * which a reader must be able to tell apart from an observed STARTING.
   *
   * READ THIS, not {@link populationReliable}, to classify the population: the boolean
   * is `true` iff this is `'HEALTHY'`, so it collapses STARTING, DEGRADED and FAILED
   * into one `false`.
   */
  readonly populationState: SensorHealthState | null;
  /** The capability GATE agent-scoped consumers read. Not a lifecycle classifier. */
  readonly populationReliable: boolean;
  /** The population leaf's `lastSuccessAt`: how old the agent list is. */
  readonly populationAsOf: number | null;
  /** Annotation. Gates nothing — a PID match needs no birth witness. */
  readonly identityQuality: 'witnessed' | 'birth-time' | 'unknown' | null;
  /**
   * True when the platform declares a birth time and this tick's observation of it
   * failed, so every key collapsed to `<pid>:u`. The CIM fallback is NOT this.
   */
  readonly identityDegraded: boolean;
  readonly sensors: AppHealthSensors;
  readonly watchPlan: AppHealthWatchPlan | null;
}
