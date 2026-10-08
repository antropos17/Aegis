'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const root = process.argv[2];
process.stdout.write('fixture-started\n');
const source = fs.readFileSync(root + '/cloud-cancellation-runtime.cjs', 'utf8');
// Test-only fixed-loader substitution, with the actual production runtime gate.
vm.runInNewContext(
  source,
  {
    Buffer,
    setImmediate,
    setTimeout,
    clearTimeout,
    process,
    require(name) {
      if (name.startsWith('node:')) return require(name);
      if (name !== 'C:\\ProgramData\\AegisCloudLab\\trusted\\cloud-cancellation-task.cjs')
        throw Error('unexpected-test-task');
      require(root + '/cloud-cancellation-task.cjs');
    },
  },
  { filename: 'fixed-cancellation-runtime-control.cjs' },
);
