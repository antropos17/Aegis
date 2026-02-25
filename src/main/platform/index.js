/**
 * @file platform/index.js
 * @description Platform abstraction layer — delegates to win32, darwin, or linux module.
 * @since v0.3.0
 */
'use strict';

const platform = process.platform;

let impl;
if (platform === 'win32') {
  impl = require('./win32');
} else if (platform === 'darwin') {
  impl = require('./darwin');
} else {
  impl = require('./linux');
}

module.exports = impl;
