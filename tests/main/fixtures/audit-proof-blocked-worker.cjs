'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const fd = fs.openSync(workerData.pipe, 'r');
parentPort.postMessage('blocked');
try { fs.readSync(fd, Buffer.alloc(1), 0, 1, null); } finally { fs.closeSync(fd); }
