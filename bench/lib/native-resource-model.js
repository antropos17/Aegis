'use strict';
const { evaluateResourceIntervals } = require('./resource-intervals');
const { hash } = require('./native-task-plan');

/** Consume actual cross-API brackets without treating shared kernel accounting as calibration.
 * @param {object} repetition Recorded worker lifetime and acquisition rows.
 * @param {string} sourceSha256 Frozen source declaration hash.
 * @returns {object} Existing evaluator packet/result and separately qualified corroboration.
 * @since unreleased */
function evaluateNativeResources(repetition, sourceSha256) {
  const { samples, ready, id } = repetition;
  const checks = samples.map((s) => {
    const lower = s.before.userUs + s.before.kernelUs;
    const upper = s.after.userUs + s.after.kernelUs;
    const self = s.self.cpuUs;
    return {
      sampleId: s.id,
      identityMatches:
        s.before.birthTicks === ready.birthTicks && s.after.birthTicks === ready.birthTicks,
      cpuEnclosed: lower <= upper && self + 2 >= lower && self <= upper + 2,
      beforeCpuUs: lower,
      selfCpuUs: self,
      afterCpuUs: upper,
      workingSetDifferenceBytes: s.self.workingSetBytes - s.after.residentBytes,
      workingSetSanity: [s.self.workingSetBytes, s.after.residentBytes].every(
        (v) => Number.isSafeInteger(v) && v >= 1024 ** 2 && v <= 1024 ** 3,
      ),
      acquisitionUs: s.acquisitionUs,
    };
  });
  const good = checks.every((c) => c.identityMatches && c.cpuEnclosed && c.workingSetSanity);
  const input = {
    version: 'resource-intervals/1',
    runId: id,
    cadenceUs: 1000000,
    sampleWindow: { startUs: 0, endUs: 3000000 },
    units: { wall: 'us', cpu: 'us', memory: 'bytes' },
    provenance: {
      collectorId: 'win32-owned-resource-reader',
      clockId: 'parent-hrtime',
      sourceSha256,
    },
    memory: {
      platform: 'win32',
      definition: 'working-set',
      api: 'GetProcessMemoryInfo',
      sharedPages: 'may-double-count',
    },
    phases: [{ id: 'controlled-work', kind: 'workload', steady: true, startUs: 0, endUs: 3000000 }],
    cohorts: ['controlled-worker'],
    lifetimes: [
      { id: 'worker', pid: ready.pid, cohort: 'controlled-worker', startUs: 0, endUs: null },
    ],
    samples: samples.map((s) => ({
      id: s.id,
      scheduledUs: s.scheduledUs,
      actualUs: s.actualUs,
      populationKnown: good,
      members: [
        {
          lifetime: 'worker',
          userUs: s.after.userUs,
          kernelUs: s.after.kernelUs,
          residentBytes: s.after.residentBytes,
        },
      ],
    })),
  };
  const result = evaluateResourceIntervals(input);
  const progress = samples.length > 1 && checks.at(-1).afterCpuUs > checks[0].afterCpuUs;
  return {
    input,
    result,
    corroboration: {
      state: samples.length === 4 && good && progress ? 'corroborated' : 'refused-or-incomplete',
      checks,
      progress,
      expected: {
        cpuFloorAllowanceUs: 2,
        workingSetSanityMinBytes: 1024 ** 2,
        workingSetSanityMaxBytes: 1024 ** 3,
      },
      sharedKernelAccounting: true,
      independentPhysicalCalibration: false,
      collectorOnOffCost: null,
      productOverhead: null,
      w8Accepted: false,
    },
    evidenceSha256: hash(repetition),
  };
}
module.exports = { evaluateNativeResources };
