'use strict';
const { isMainThread, Worker, parentPort, workerData } = require('node:worker_threads');
if (isMainThread) {
  const { debuglog } = require('node:util');
  const [control, clientEntry] = process.argv.slice(2);
  const initialDebug = debuglog('worker').enabled;
  if (control === 'cached') delete process.env.NODE_DEBUG;
  if (control === 'late') process.env.NODE_DEBUG = 'worker';
  let snapshots = 0;
  let constructed = 0;
  const protocol = require(
    require('node:path').join(require('node:path').dirname(clientEntry), 'cedar-worker-thread'),
  );
  const snapshot = protocol.snapshotRequest;
  protocol.snapshotRequest = (...args) => {
    snapshots++;
    return snapshot(...args);
  };
  const client = require(clientEntry).createCedarWorkerClient({
    WorkerClass: class extends Worker {
      constructor(entry, options) {
        constructed++;
        super(entry, options);
      }
    },
  });
  const canary = 'CEDAR_R2_DIAGNOSTIC_CANARY_1049';
  client
    .evaluate(
      {
        schemaVersion: 4,
        cedarSchema: 'aegis-execution-v1',
        policies: { allow: 'permit(principal, action, resource);' },
      },
      {
        executable: process.execPath,
        cwd: require('node:path').join(process.cwd(), canary),
        args: [canary],
        env: { CANARY: canary },
      },
    )
    .then((result) => {
      console.log(
        JSON.stringify({
          result,
          initialDebug,
          effectiveDebug: debuglog('worker').enabled,
          envDebugPresent: !!process.env.NODE_DEBUG,
          snapshots,
          constructed,
        }),
      );
    })
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(() => client.close());
} else {
  const { mode, request, marker, entry } = workerData;
  if (marker) Atomics.store(marker, 0, 1);
  if (mode === 'startup-hang')
    while (true) {
      /* deliberate synchronous startup hang */
    }
  if (mode === 'crash') throw Error('PRIVATE_CRASH_PATH');
  if (mode === 'malformed') {
    parentPort.postMessage({
      decision: 'allow',
      reason: 'policy-allow',
      policyIds: ['allow'],
      launch: 'PRIVATE',
    });
  } else if (mode === 'duplicate') {
    const reply = { decision: 'allow', reason: 'policy-allow', policyIds: ['allow'] };
    parentPort.postMessage(reply);
    parentPort.postMessage(reply);
  } else if (mode === 'evaluation-hang') {
    const runtime = require(
      require('node:path').join(require('node:path').dirname(entry), 'cedar-runtime.js'),
    );
    runtime.compileCedarPolicy = () => ({
      ok: true,
      evaluate() {
        if (marker) Atomics.store(marker, 0, 2);
        while (true) {
          /* uninterruptible caller work */
        }
      },
    });
    parentPort.postMessage(require(entry).evaluateRequest(request));
  } else if (mode === 'environment') {
    if (Object.keys(process.env).length) throw Error('PRIVATE_INHERITED_ENVIRONMENT');
    console.log('PRIVATE_WORKER_STDOUT');
    console.error('PRIVATE_WORKER_STDERR');
    parentPort.postMessage(require(entry).evaluateRequest(request));
  }
  parentPort.close();
}
