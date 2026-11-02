'use strict';

const engine = require('minimatch-engine');
const { platform } = require('node:process');

// glob 7 walks the parsed set as POSIX path components, including on Windows,
// and uses each parsed pattern's _glob label and String.match() interface.
// Version 11 stores nonrecursive Matcher objects rather than RegExp objects.
class Minimatch extends engine.Minimatch {
  constructor(pattern, options) {
    const legacyGlob =
      options?.nonegate === true &&
      options?.nocomment === true &&
      options?.allowWindowsEscape === false;
    super(pattern, legacyGlob ? { ...options, platform: 'linux' } : options);
    if (!legacyGlob) return;
    const legacySet = this.set.map((parts, row) =>
      parts.map((part, column) =>
        typeof part === 'object' && typeof part.test === 'function'
          ? {
              _glob: this.globParts[row][column],
              [Symbol.match]: (value) => (part.test(value) ? [value] : null),
            }
          : part,
      ),
    );
    // Methods retain their upstream receiver and private fields; only glob 7's
    // external traversal view changes. Never alter the engine's internal set.
    return new Proxy(this, {
      get(target, key) {
        if (key === 'set') return legacySet;
        if (key === 'match')
          return (value, partial) =>
            engine.Minimatch.prototype.match.call(
              target,
              platform === 'win32' ? value.replaceAll('\\', '/') : value,
              partial,
            );
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}

// ASAR, dir-compare and glob 7 expect require('minimatch') to be callable.
// Matching, parsing and all helpers come from the patched upstream engine.
// Keep a distinct function so adding the legacy surface does not mutate it.
module.exports = Object.assign((...args) => engine.minimatch(...args), engine, { Minimatch });
