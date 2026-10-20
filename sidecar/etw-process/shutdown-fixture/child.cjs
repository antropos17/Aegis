// Synthetic process-supervision proof only. Never imports native ETW code.
'use strict';
const [mode, generation] = process.argv.slice(2);
const provider = '22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716';
const receipt = {
  callbacks: 0,
  admitted: 0,
  unknown: 0,
  dropped: 0,
  providerFailures: 0,
  nativeStopStatus: 0,
  consumerCompleted: true,
  consumerSucceeded: true,
  loss: { nativeEventsLost: 0, nativeBuffersLost: 0 },
};
const frames = ['begin', 'stopping', 'stop'].map((type, i) => ({
  protocol: 'aegis-etw-process-diagnostic',
  version: 1,
  provider,
  generation,
  sequence: i + 1,
  type,
  observation: null,
  receipt: i === 2 ? receipt : null,
}));
if (mode === 'normal') process.stdout.write(JSON.stringify(frames));
else if (mode === 'partial') process.stdout.write('[');
else if (mode === 'malformed') process.stdout.write('{"private":"must-not-escape"}');
else if (mode === 'overflow') process.stdout.write(Buffer.alloc(300000, 120));
else if (mode === 'blocked-stop' || mode === 'blocked-consumer') {
  // Intentionally never emits terminal evidence. OS termination is owned by parent.
  setInterval(() => {}, 1000);
} else process.exitCode = 2;
