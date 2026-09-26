import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../src/main/safe-storage.js', import.meta.url), 'utf8');
function storage(backend, available = true, options = {}) {
  const module = { exports: {} };
  const safeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (text) => Buffer.from(text),
    decryptString: options.decryptString ?? ((buffer) => buffer.toString()),
  };
  vm.runInNewContext(source, {
    module,
    Buffer,
    require: (name) =>
      name === 'electron' ? { safeStorage } : (options.logger ?? { warn() {}, error() {} }),
  });
  return module.exports;
}
describe('secure OS storage availability', () => {
  it('rejects the Linux basic_text backend even when encryption is reported available', () => {
    const api = storage('basic_text');
    expect(api.isAvailable()).toBe(false);
    expect(api.encrypt('fixture')).toBeNull();
    expect(api.decrypt('b3BhcXVl')).toBe('');
  });
  it('accepts secure backends and fails closed when the keychain is unavailable', () => {
    expect(storage('gnome_libsecret').isAvailable()).toBe(true);
    expect(storage(undefined).isAvailable()).toBe(true);
    expect(storage('gnome_libsecret', false).encrypt('fixture')).toBeNull();
  });
  it('keeps private native decryption errors out of operational diagnostics', () => {
    const errors = [];
    const canary = 'PRIVATE_PROFILE_OR_KEY_BLOB_CANARY';
    const api = storage('gnome_libsecret', true, {
      decryptString: () => {
        throw new Error(canary);
      },
      logger: { warn() {}, error: (...args) => errors.push(args) },
    });

    expect(api.decrypt('b3BhcXVl')).toBe('');
    expect(errors).toEqual([['safe-storage', 'Decryption failed', { code: 'decryption-failed' }]]);
    expect(JSON.stringify(errors)).not.toContain(canary);
  });
});
