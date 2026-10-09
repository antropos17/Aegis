'use strict';

// Fixed lab consumer of real standard handles. No terminal commands or provider calls.
let observed = 0;
const chunks = [];
const kind = Number(process.env.AEGIS_STDIO_CASE || '1');
if (!Number.isInteger(kind) || kind < 1 || kind > 5) process.exit(125);
if (kind >= 3) {
  // Fixed negative controls stay alive until owned Job termination, including broken-pipe events.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  if (kind === 3) process.stdout.write(Buffer.alloc(20000, 79));
  if (kind === 4) process.stderr.write(Buffer.alloc(20000, 69));
  setInterval(() => {}, 1000);
}
if (kind === 2) {
  process.stdout.write(Buffer.alloc(48000, 79));
  process.stderr.write(Buffer.alloc(48000, 69));
}
process.stdin.on('data', (chunk) => {
  observed += chunk.length;
  if (observed > 65536) process.exit(125);
  chunks.push(chunk);
});
process.stdin.on('error', () => process.exit(125));
process.stdin.on('end', () => {
  if (kind >= 3) return;
  const bytes = Buffer.concat(chunks, observed);
  process.stdout.write(bytes);
  if (kind === 1) process.stderr.write(bytes);
});
if (kind === 5) setImmediate(() => process.stdout.write(Buffer.from([82])));
