import { beforeAll, describe, expect, it } from 'vitest';
import { collectGuestChannel } from '../../scripts/qualification/qualify-guest-channel.mjs';
import {
  GUEST_CHANNEL_MODES,
  GUEST_CHANNEL_REFUSALS,
} from '../../scripts/qualification/guest-channel-report.mjs';

describe('guest channel fixed input', () => {
  it.each([[], ['admit', 'admit'], ['arbitrary command'], ['admit', '--vm-id']])(
    'rejects unsupported matrix %j before effects',
    async (...modes) => {
      await expect(collectGuestChannel(modes)).rejects.toThrow();
    },
  );
});
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'fixed Windows channel and Node/Git workflow',
  () => {
    let receipt;
    beforeAll(async () => {
      const selected = [...GUEST_CHANNEL_MODES];
      const pending = collectGuestChannel(selected);
      selected.push('late injected command');
      receipt = await pending;
    }, 60000);
    it('runs the pinned fixed matrix with actual compiler/source/tool provenance and fresh held identities', () => {
      expect(receipt.cases.map((item) => item.proof.mode)).toEqual(GUEST_CHANNEL_MODES);
      expect(Object.keys(receipt.sourceSha256)).toHaveLength(13);
      expect(receipt.nodeVersion).toBe(process.versions.node);
      expect(receipt.gitVersion).toMatch(/^git version /);
      for (const field of ['processStampSha256', 'jobSha256'])
        expect(new Set(receipt.cases.map((item) => item.proof[field])).size).toBe(9);
      for (const item of receipt.cases) {
        expect(item.proof.imageSha256).toBe(receipt.executableSha256);
        expect(item.proof.nodeSha256).toBe(receipt.nodeExecutableSha256);
        expect(item.proof.gitSha256).toBe(receipt.gitExecutableSha256);
        expect(item.nodeInitializationVerified).toBe(true);
      }
    });
    it('performs the fixed edit, node test and local git baseline/diff after authenticated release', () => {
      const item = receipt.cases[0];
      expect(item.proof).toMatchObject({
        taskObserved: true,
        resultAccepted: true,
        stopMessageAccepted: true,
        childExited: true,
        jobEmpty: true,
        refusalReason: null,
      });
      expect(item.localOracle).toMatchObject({
        localFilesObserved: true,
        authenticatedTaskResultVerified: true,
      });
      expect(item.nodeChannelVerified).toBe(true);
      expect(item.localOracle.sourceBeforeSha256).not.toBe(item.localOracle.sourceAfterSha256);
    });
    it('cancels before any project is created and distinguishes the stopped message from queried closure', () => {
      const item = receipt.cases[1];
      expect(item.proof).toMatchObject({
        taskObserved: false,
        resultAccepted: false,
        stopMessageAccepted: true,
        childExited: true,
        jobEmpty: true,
      });
      expect(item.localOracle.localFilesObserved).toBe(false);
      expect(item.nodeChannelVerified).toBe(true);
    });
    it.each(GUEST_CHANNEL_MODES.slice(2))(
      'requires the exact injected %s refusal and actual Job closure',
      (mode) => {
        const item = receipt.cases.find((value) => value.proof.mode === mode);
        expect(item.proof.refusalReason).toBe(GUEST_CHANNEL_REFUSALS[mode]);
        expect(item.proof).toMatchObject({
          resultAccepted: false,
          stopMessageAccepted: false,
          childExited: true,
          jobEmpty: true,
        });
        expect(item.localOracle.authenticatedTaskResultVerified).toBe(false);
        expect(item.proof.taskObserved).toBe(['bad-result', 'oversized-result'].includes(mode));
      },
    );
    it('retains no key, raw frame, correlation binding, executable path or user SID', () => {
      expect(JSON.stringify(receipt)).not.toMatch(
        /"key"|"challenge"|FrameBase64|"sessionId"|"vmId"|"epoch"|S-1-5-21-|[A-Z]:[\\/]/,
      );
    });
    it('never promotes local pipe/Node/Git results into VM isolation or guest-runtime qualification', () => {
      expect(receipt.summary).toMatchObject({
        transport: 'anonymous-pipe',
        samePrincipalFixture: true,
        runtimeSubsetOnly: true,
        completeJobMemberInventory: false,
        vmEffectsRun: false,
        guestNodeGitQualified: false,
        launchAllowed: false,
        nativeContainmentQualified: false,
      });
    });
  },
);
