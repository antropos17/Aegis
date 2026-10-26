'use strict';

/** Derive only observed useful-work figures; missing capture is never measured zero.
 * @param {object} evidence Actual runner evidence. @returns {object} Public summary. @since 0.21.0 */
function summarizeRun(evidence) {
  const tasks = evidence.attempts.flatMap((a) => a.tasks.map((t) => ({ ...t, arm: a.arm })));
  const rawEvents = evidence.attempts
    .filter((a) => a.arm === 'enabled')
    .map((a) => a.monitor?.after?.events || []);
  const deduplicated = rawEvents.map(
    (events) => new Set(events.map((e) => e.eventId || JSON.stringify(e))).size,
  );
  const times = tasks.map((t) => t.endMs - t.startMs);
  const repetitions = evidence.latency.result.repetitions.map((r) => ({
    pairId: r.pairId,
    order: r.order,
    denominator: r.denominator,
    disabled: r.completion.disabled,
    enabled: r.completion.enabled,
    pairedRatio: r.pairedRatio,
    reasons: r.reasons,
  }));
  return {
    version: 'native-task-summary/1',
    context: evidence.context,
    observed: {
      started: tasks.length,
      completed: tasks.filter((t) => t.outcome === 'completed').length,
      failed: tasks.filter((t) => t.outcome === 'failed').length,
      timedOut: tasks.filter((t) => t.outcome === 'timed-out').length,
      ordinaryCompleted: tasks.filter((t) => t.taskId === 'ordinary' && t.outcome === 'completed')
        .length,
      controlledOutsideEffects: tasks.filter(
        (t) => t.taskId === 'outside-write' && t.independent.exactBytes,
      ).length,
      taskLatencyMinMs: times.length ? Math.min(...times) : null,
      taskLatencyMaxMs: times.length ? Math.max(...times) : null,
      capturedFixtureFileEvents: deduplicated.reduce((a, b) => a + b, 0),
      localCaptureEvictions: evidence.attempts.reduce(
        (n, a) => n + (a.monitor?.after?.evicted || 0),
        0,
      ),
    },
    comparison: evidence.latency.result.comparison,
    repetitions,
    falseAlarmIncidence: evidence.falseAlarms.result.incidence,
    sensor: {
      hits: null,
      misses: null,
      falseAlarms: null,
      recall: null,
      detectionLatencyMs: null,
      responseLatencyMs: null,
    },
    overhead: { cpu: null, rss: null, calibratedTaskLatency: null },
    oracles: evidence.oracles,
    unavailable: evidence.unavailable,
    acceptance:
      'Controlled native-workload diagnostic only; real-AI-agent corpus, native oracle admission and W8/T8 acceptance remain open.',
  };
}

/** Render numeric cells produced by the runner and the existing evaluator.
 * @param {object} summary Script-produced summary. @returns {string} Markdown report. @since 0.21.0 */
function markdown(summary) {
  const number = (v) => (v === null || v === undefined ? 'unavailable' : String(v));
  return (
    `# Controlled Windows native workload — ${summary.context.recordedAt.slice(0, 10)}\n\n` +
    `Source: \`${summary.context.sourceCommit}\`; machine \`${summary.context.machine}\`; Windows \`${summary.context.os.release}\`, ${summary.context.os.arch}. Agent: \`${summary.context.agent.version}\` (controlled native program; no AI provider/model). Sensor mode: ${summary.context.sensorMode}. Method: \`${summary.context.method}\`.\n\n` +
    `The script ran ${summary.observed.started} tasks: ${summary.observed.completed} completed, ${summary.observed.failed} failed and ${summary.observed.timedOut} timed out. Independent exact-byte/inventory checks verified ${summary.observed.ordinaryCompleted} ordinary aggregates and ${summary.observed.controlledOutsideEffects} controlled outside-project effects, all inside owned disposable directories. Raw captured fixture-file event count: ${summary.observed.capturedFixtureFileEvents}; it is not a hit count. The local callback buffer evicted ${summary.observed.localCaptureEvictions} records; native sensor loss/completeness is unqualified.\n\n` +
    '| Pair | Order | Tasks | Disabled p50 ms | Disabled p95 ms | Enabled p50 ms | Enabled p95 ms | Median task ratio |\n|---|---|---:|---:|---:|---:|---:|---:|\n' +
    summary.repetitions
      .map(
        (r) =>
          `| ${r.pairId} | ${r.order.join(' → ')} | ${r.denominator} | ${number(r.disabled.p50Ms)} | ${number(r.disabled.p95Ms)} | ${number(r.enabled.p50Ms)} | ${number(r.enabled.p95Ms)} | ${number(r.pairedRatio.p50)} |`,
      )
      .join('\n') +
    `\n\nObserved per-task latency range: ${number(summary.observed.taskLatencyMinMs)}–${number(summary.observed.taskLatencyMaxMs)} ms. This range and the separate repetitions retain variation; the same host and cache/background activity limit generalization. Evaluator comparison status: \`${summary.comparison.status}\`.\n\n` +
    'Sysmon and Procmon are separate unavailable columns: same-run capture was not configured. Hits, misses, recall, false-alarm incidence, detection/response latency and calibrated CPU/RSS overhead remain unavailable. The outcome oracle proves files and useful output, not OS event emission or provenance. The false-alarm evaluator retains incomplete exposure rather than manufacturing zero alarms.\n\n' +
    'The actual desktop runs used fresh profiles/homes, one-second polling, notifications disabled and no explicit ETW read opt-in. Warmup is a fixed minimum five seconds; startup is excluded from task clocks. These short diagnostic cells do not implement the longer qualification phases or independent instrumentation calibration in METHOD.md.\n\n' +
    summary.acceptance +
    '\n'
  );
}
/** Publish actual native-worker resource observations consumed by the existing evaluator.
 * @param {object} evidence Retained real acquisition and independent output checks.
 * @returns {object} Public diagnostic summary, never product overhead. @since unreleased */
function summarizeResourceRun(evidence) {
  return {
    version: 'native-worker-resources-summary/1',
    context: evidence.context,
    repetitions: evidence.repetitions.map((r) => ({
      id: r.id,
      usefulOutput: r.usefulOutput,
      cleanup: r.cleanup,
      corroboration: r.evaluation.corroboration,
      estimates: r.evaluation.result.estimates,
      excludedBoundaryIntervals: r.evaluation.result.intervals.filter((x) => x.reason !== null),
      rawSampleCount: r.samples.length,
    })),
    productOverhead: { cpu: null, rss: null },
    sensor: { hits: null, misses: null, recall: null, falseAlarms: null },
    calibration:
      'Shared-kernel API/unit corroboration only; independent physical accuracy and collector-on/off cost unqualified.',
    acceptance:
      'Controlled native workload resources only; no AI-agent, complete product cohort, sensor or W8 acceptance.',
  };
}

/** Render only script-produced native resource figures. @param {object} summary Summary.
 * @returns {string} Markdown. @since unreleased */
function resourceMarkdown(summary) {
  return (
    '# Controlled Windows native worker resources\n\n' +
    `Source: \`${summary.context.sourceCommit}\`; machine \`${summary.context.machine}\`; OS \`${summary.context.os.release}\` ${summary.context.os.arch}; worker \`${summary.context.agent.version}\`; sensor mode: ${summary.context.sensorMode}; method: \`${summary.context.method}\`.\n\n` +
    '| Repetition | Useful files verified | Samples | CPU p50 / p95 (% one core) | Working set p50 / p95 (bytes) | API corroboration |\n|---|---:|---:|---|---|---|\n' +
    summary.repetitions
      .map((r) => {
        const cpu = r.estimates.find((x) => x.metric === 'cpu-one-core-pct');
        const rss = r.estimates.find((x) => x.metric === 'resident-bytes');
        return `| ${r.id} | ${r.usefulOutput.filter((x) => x.exactBytes && x.inventoryMatches).length} | ${r.rawSampleCount} | ${cpu.p50} / ${cpu.p95} | ${rss.p50} / ${rss.p95} | ${r.corroboration.state} |`;
      })
      .join('\n') +
    '\n\n' +
    summary.calibration +
    '\n\n' +
    'Three fixed repetitions are retained separately. First/last acquisition brackets and boundary exclusions remain in JSON; late final endpoints are excluded by the unchanged evaluator, not moved into the phase. CPU includes the fixed task and waiting within each sampled interval. Working set can include shared pages. Sampler/reference processes are outside the named single-worker scope; no product-cohort total is inferred.\n\n' +
    'Independent output checks use a closed-form CSV sum, exact bytes and owned-directory inventory. Sysmon and Procmon were not captured; hits, misses, recall, false alarms and calibrated product CPU/RSS overhead remain unavailable.\n\n' +
    summary.acceptance +
    '\n'
  );
}
module.exports = { summarizeRun, markdown, summarizeResourceRun, resourceMarkdown };
