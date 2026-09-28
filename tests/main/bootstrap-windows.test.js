import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import { collectNativeBootstrap } from '../../scripts/qualification/qualify-native-bootstrap.mjs';
import {
  BOOTSTRAP_MODES,
  BOOTSTRAP_REFUSALS,
} from '../../scripts/qualification/bootstrap-report.mjs';

describe('native bootstrap fixed-command input', () => {
  it.each([['arbitrary command'], ['admit', 'admit'], [], ['admit', '--vm-id']])(
    'refuses an unsupported matrix %j before compilation',
    async (...modes) => {
      await expect(collectNativeBootstrap(modes)).rejects.toThrow('native-bootstrap-invalid');
    },
  );
});

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native initialized child and held-handle admission fixture',
  () => {
    let receipt;
    beforeAll(async () => {
      const modes = [...BOOTSTRAP_MODES];
      const pending = collectNativeBootstrap(modes);
      modes.push('arbitrary command injected after validation');
      receipt = await pending;
    }, 45000);

    it('snapshots the fixed matrix and records native provenance with a fresh process/Job for each case', () => {
      expect(receipt.osBuild).toBe(Number(os.release().split('.')[2]));
      expect(receipt.cases.map((item) => item.proof.mode)).toEqual(BOOTSTRAP_MODES);
      expect(Object.keys(receipt.sourceSha256)).toHaveLength(10);
      for (const hash of [
        receipt.compilerSha256,
        receipt.executableSha256,
        ...Object.values(receipt.sourceSha256),
      ])
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      for (const key of ['processStampSha256', 'jobSha256'])
        expect(new Set(receipt.cases.map((item) => item.proof[key])).size).toBe(9);
      for (const item of receipt.cases) {
        expect(item.proof.imageSha256).toBe(receipt.executableSha256);
        expect(item.proof).toMatchObject({
          inOwnedJob: true,
          samePrincipal: true,
          jobKillOnClose: true,
        });
      }
    });

    it('releases the fixed task only after native initialized observation and verifies its frame in JS', () => {
      const item = receipt.cases[0];
      expect(item.proof).toMatchObject({
        initialized: true,
        heldIdentityConfirmed: true,
        payloadReleased: true,
        workCompleted: true,
        childExited: true,
        jobEmpty: true,
      });
      expect(item.nodeFrameVerified).toBe(true);
    });

    it('cancels a ready child and independently observes a closed Job killing its held child', () => {
      for (const item of receipt.cases.slice(1, 3)) {
        expect(item.nodeFrameVerified).toBe(true);
        expect(item.proof).toMatchObject({
          initialized: true,
          heldIdentityConfirmed: true,
          payloadReleased: false,
          workCompleted: false,
          childExited: true,
        });
      }
      expect(receipt.cases[1].proof.jobEmpty).toBe(true);
      expect(receipt.cases[2].proof.jobEmpty).toBe(false);
      expect(receipt.cases[2].summary.ownedJobEmptyConfirmed).toBe(false);
    });

    it.each(BOOTSTRAP_MODES.slice(3))(
      'rejects %s without release and confirms native teardown',
      (mode) => {
        const item = receipt.cases.find((row) => row.proof.mode === mode);
        expect(item.nodeFrameVerified).toBe(false);
        expect(item.proof).toMatchObject({
          initialized: false,
          heldIdentityConfirmed: false,
          payloadReleased: false,
          workCompleted: false,
          childExited: true,
          jobEmpty: true,
          refusalReason: BOOTSTRAP_REFUSALS[mode],
        });
      },
    );

    it('checks the exact Hyper-V address codec without claiming a connected peer or VM effects', () => {
      for (const item of receipt.cases) {
        expect(item.proof.endpointCodecPassed).toBe(true);
        expect(item.summary.endpointCodecOnly).toBe(true);
      }
      expect(receipt.summary).toMatchObject({
        caseCount: 9,
        samePrincipalFixture: true,
        runtimeSubsetOnly: true,
        vmBindingSynthetic: true,
        vmEffectsRun: false,
        launchAllowed: false,
        nativeContainmentQualified: false,
      });
    });

    it('retains no credential, challenge, frame, user SID or absolute host path in the receipt', () => {
      const json = JSON.stringify(receipt);
      expect(json).not.toMatch(
        /"key"|"challenge"|"frameBase64"|"sessionId"|"vmId"|"epoch"|S-1-5-21-|\\Users\\/,
      );
    });
  },
);
