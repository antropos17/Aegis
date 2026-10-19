'use strict';
// Disposable transport control only; never selected by the production provider.
const mode = process.argv[2];
const canary = 'PRIVATE_TRANSPORT_CANARY';
process.stdin.resume();
process.stdin.once('data', () => {
  if (mode === 'stall') return;
  if (mode === 'stderr') {
    process.stderr.write(canary);
    return;
  }
  if (mode === 'abrupt') {
    process.exit(0);
    return;
  }
  const emit = () => {
    const payload = Buffer.from(
      mode === 'malformed' ? canary : JSON.stringify({ id: mode === 'wrongid' ? 2 : 1, ok: true }),
    );
    const frame = Buffer.alloc(payload.length + 4);
    frame.writeUInt32LE(mode === 'overframe' ? 1024 * 1024 : payload.length);
    payload.copy(frame, 4);
    process.stdout.write(frame);
  };
  if (mode === 'late') setTimeout(emit, 500);
  else emit();
});
