# Legacy build-tool minimatch adapter

All matching delegates to upstream minimatch 11.0.3, installed under the
`minimatch-engine` alias. The private package retains the dependency's `minimatch`
name for npm dependency validation; `11.0.3-aegis.1` identifies the upstream
engine plus this local adapter, and is never published. It restores the callable CommonJS
export expected by ASAR 3, dir-compare 4, filelist 1 and glob 7, plus glob 7's
POSIX traversal view, `_glob` labels and `String.match` interface. Version 11's
nonrecursive Matcher objects perform the actual matching. A proxy keeps upstream
methods bound to their original private-field receiver and leaves the engine's
internal parsed set unchanged. Modern operations retain the upstream interface.
The adapter contains no copied matcher/parser code.

The root installs this private package as a local development dependency and
uses npm's `$minimatch` override for every consumer. `.npmrc` enables
`install-links` so clean installs pack the local dependency and install its
engine without relying on existing symlinks or consumers' installation paths.
ES module imports and declarations re-export upstream directly. CommonJS keeps
the upstream namespace on a callable function; only glob 7's explicit traversal
options select the legacy parsed-set view. Review both the adapter and override
when upgrading its consumers or engine.

`tests/main/minimatch-build-compat.test.js` checks each actual resolution, modern
matching, legacy traversal/comparison, electron-builder filtering, real ASAR
packing/unpacking and a bounded level-2 preprocessing case. A clean `npm ci`
must preserve this resolution; a missing adapter or obsolete engine fails the checks.
This is development tooling and is excluded from the packaged application.
