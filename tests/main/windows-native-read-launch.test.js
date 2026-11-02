import { describe, expect, it, vi } from 'vitest';
import {
  NATIVE_READ_ELECTRON_LAUNCH_TIMEOUT_MS,
  launchNativeReadElectron,
} from '../../scripts/qualification/windows-native-read-launch.mjs';

describe('Windows native-read Electron launch', () => {
  it('sets one 90 second deadline for the bounded cold-guest launch', async () => {
    const observation = {};
    const app = { process: () => ({ pid: 42 }) };
    const launch = vi.fn(async (options) => {
      expect(options).toEqual({ executablePath: 'AEGIS.exe', args: ['--qa'], timeout: 90_000 });
      return app;
    });
    const ticks = [1_000, 46_250];

    await expect(
      launchNativeReadElectron({
        launch,
        options: { executablePath: 'AEGIS.exe', args: ['--qa'] },
        observation,
        now: () => ticks.shift(),
      }),
    ).resolves.toBe(app);

    expect(launch).toHaveBeenCalledOnce();
    expect(NATIVE_READ_ELECTRON_LAUNCH_TIMEOUT_MS).toBe(90_000);
    expect(observation).toEqual({
      schema: 'aegis-native-read-electron-launch/1',
      phase: 'connected',
      timeoutMilliseconds: 90_000,
      returned: true,
      elapsedMilliseconds: 45_250,
    });
  });

  it.each([
    ['TimeoutError', 'timeout'],
    ['Error', 'launch-error'],
  ])('retains only a closed failure code for %s', async (name, failureCode) => {
    const privateValue = 'PRIVATE_CANARY_C:\\Users\\owner\\profile';
    const failure = Object.assign(new Error(privateValue), { name });
    const observation = {};
    const launch = vi.fn().mockRejectedValue(failure);
    const ticks = [2_000, 92_125];

    await expect(
      launchNativeReadElectron({
        launch,
        options: {
          executablePath: privateValue,
          args: ['--endpoint=' + privateValue],
          env: { SECRET: privateValue },
        },
        observation,
        now: () => ticks.shift(),
      }),
    ).rejects.toBe(failure);

    expect(observation).toEqual({
      schema: 'aegis-native-read-electron-launch/1',
      phase: 'failed',
      timeoutMilliseconds: 90_000,
      returned: false,
      elapsedMilliseconds: 90_125,
      failureCode,
    });
    expect(JSON.stringify(observation)).not.toContain(privateValue);
  });
});
