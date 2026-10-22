import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import observer from '../../scripts/qualification/windows-updater-observer.cjs';

const api = 'https://api.github.com/repos/antropos17/Aegis/releases?per_page=30';
function fixture(fetcher) {
  const info = { version: '0.20.1-beta', files: [{}], verified: { version: '0.20.1-beta' } };
  const result = { isUpdateAvailable: true, updateInfo: info };
  class Provider {
    constructor() {
      this.updater = { currentVersion: { version: '0.20.0-beta' }, allowPrerelease: true };
    }
    async getLatestVersion() {
      return info;
    }
  }
  class Updater {
    constructor() {
      this.currentVersion = { version: '0.20.0-beta' };
    }
    async checkForUpdates() {
      return result;
    }
  }
  const net = { fetch: fetcher };
  const scope = {
    Buffer,
    setTimeout,
    clearTimeout,
    electron: { net, app: { getAppPath: () => '/fixture/app.asar' } },
    process: {
      mainModule: {
        require: (name) => {
          if (name === '/fixture/app.asar/src/main/update-provider.js')
            return { SignedReleaseProvider: Provider };
          if (name === 'electron-updater') return { NsisUpdater: Updater };
          throw Error('Unexpected fixture module');
        },
      },
    },
  };
  vm.runInNewContext(`(${observer.installUpdaterObserver.toString()})(electron)`, scope);
  return { net, scope, Provider, Updater, info, result };
}

describe('published updater observer', () => {
  it('captures the actual public response while retaining its identity, body and fetch options', async () => {
    const body = JSON.stringify([{ tag_name: 'aegis-v0.20.1-beta' }]);
    const response = new Response(body, { headers: { etag: 'fixture-etag' } });
    const options = { credentials: 'omit', cache: 'no-store' };
    let actualArgs;
    const { net, scope } = fixture(async (...args) => {
      actualArgs = args;
      return response;
    });
    const actual = await net.fetch(api, options);
    expect(actual).toBe(response);
    expect(actualArgs).toEqual([api, options]);
    expect(actualArgs[1]).toBe(options);
    expect(await actual.text()).toBe(body);
    await Promise.all(scope.__qualificationUpdaterPending);
    expect(scope.__qualificationUpdater.metadata[0]).toMatchObject({
      url: api,
      status: 200,
      body,
      bytes: Buffer.byteLength(body),
      headers: { etag: 'fixture-etag' },
    });
    expect(scope.__qualificationUpdater.errors).toEqual([]);
  });

  it('records decisions without replacing the provider or updater result', async () => {
    const { Provider, Updater, info, result, scope } = fixture(async () => new Response('[]'));
    expect(await new Provider().getLatestVersion()).toBe(info);
    expect(await new Updater().checkForUpdates()).toBe(result);
    expect(scope.__qualificationUpdater.decisions).toMatchObject([
      { stage: 'provider', current: '0.20.0-beta', latest: '0.20.1-beta', verified: true },
      { stage: 'updater', current: '0.20.0-beta', latest: '0.20.1-beta', isUpdateAvailable: true },
    ]);
  });

  it('bounds captured bytes without failing the original request', async () => {
    const body = JSON.stringify(['x'.repeat(2 * 1024 * 1024)]);
    const response = new Response(body);
    const { net, scope } = fixture(async () => response);
    expect(await (await net.fetch(api)).text()).toBe(body);
    await Promise.all(scope.__qualificationUpdaterPending);
    expect(scope.__qualificationUpdater.metadata[0].error).toContain('exceeds 2 MiB');
    expect(scope.__qualificationUpdater.metadata[0].body).toBeUndefined();
  });

  it('does not capture other endpoints and preserves fetch rejection', async () => {
    const response = new Response('private fixture body');
    const error = Error('network fixture failure');
    const { net, scope } = fixture(async (url) => {
      if (url === api) throw error;
      return response;
    });
    expect(await net.fetch('https://example.invalid/private')).toBe(response);
    expect(scope.__qualificationUpdater.metadata).toEqual([]);
    await expect(net.fetch(api)).rejects.toBe(error);
    expect(scope.__qualificationUpdater.metadata).toEqual([]);
  });
});
