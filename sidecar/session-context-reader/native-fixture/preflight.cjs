'use strict';
const { privateMode } = require('../../../src/main/session-context-windows-assets');
try {
  privateMode();
  process.stdout.write('allowed');
} catch {
  process.stdout.write('refused');
}
