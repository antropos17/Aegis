import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../src/main/safe-storage.js', import.meta.url), 'utf8');
function storage(backend, available = true) {
  const module = { exports: {} };
  const safeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (text) => Buffer.from(text),
    decryptString: (buffer) => buffer.toString(),
  };
  vm.runInNewContext(source, {
    module,
    Buffer,
    require: (name) => (name === 'electron' ? { safeStorage } : { warn() {}, error() {} }),
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
});
