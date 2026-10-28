'use strict';

// Trusted Node-only bootstrap probe. Refuse Electron before it can be loaded.
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') throw Error('GUI_IMPORT_REFUSED');
  return load.call(this, request, parent, isMain);
};

process.argv = [process.execPath, ...JSON.parse(process.argv[2])];
const originalArgv = JSON.stringify(process.argv);
try {
  require('../../src/main/main.js');
  if (JSON.stringify(process.argv) !== originalArgv) throw Error('STARTUP_ARGV_CHANGED');
} catch (error) {
  if (error.message !== 'GUI_IMPORT_REFUSED') throw error;
  process.stderr.write('GUI_IMPORT_REFUSED\n');
  process.exitCode = 93;
}
