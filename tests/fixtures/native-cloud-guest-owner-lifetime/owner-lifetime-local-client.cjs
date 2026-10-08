'use strict';
// Local fixture orchestration only; native admission establishes readiness.
process.stdout.write('fixture-started\n');
require(process.argv[2]);
