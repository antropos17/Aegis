'use strict';
// Disposable upstream: every effect is confined to the test-owned directory.
const fs = require('node:fs');
const readline = require('node:readline');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(config.started, String(process.pid));
const timeout = setTimeout(() => process.exit(0), 12000);
process.stdin.on('end', () => {
  clearTimeout(timeout);
  process.exit(0);
});
process.stdout.on('error', () => process.exit(0));
let lists = 0;
const send = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (config.mode === 'hang-init') return;
    if (config.mode === 'oversize') {
      process.stdout.write('x'.repeat(16385));
      return;
    }
    if (config.mode === 'reverse-request') {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'sampling/createMessage', params: {} }) +
          '\n',
      );
      return;
    }
    if (config.mode === 'bad-utf8') {
      process.stdout.write(Buffer.from([255, 10]));
      return;
    }
    if (config.mode === 'stderr-flood') {
      process.stderr.write('PRIVATE'.repeat(6000));
      return;
    }
    process.stderr.write('PRIVATE_SERVER_DIAGNOSTIC');
    send(message.id, {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '1' },
    });
  } else if (message.method === 'tools/list') {
    lists++;
    fs.writeFileSync(config.listed, String(lists));
    if (lists > 1 && config.mode === 'death') {
      process.exit(0);
      return;
    }
    if (lists > 1 && config.mode === 'notification') {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n',
      );
      return;
    }
    if (lists > 1 && config.mode === 'mutate-policy') fs.appendFileSync(config.policy, ' ');
    const tool = { ...config.tool };
    if (lists > 1 && config.mode === 'catalog-change') tool.description = 'changed';
    send(config.mode === 'wrong-id' ? 'wrong' : message.id, { tools: [tool] });
  } else if (message.method === 'tools/call') {
    fs.appendFileSync(config.effects, JSON.stringify(message.params) + '\n');
    if (config.mode === 'hang') return;
    const structuredContent = { accepted: true };
    const content = [{ type: 'text', text: JSON.stringify(structuredContent) }];
    if (config.mode === 'extra-content') content.push({ type: 'text', text: 'PRIVATE_UNCHECKED' });
    if (config.mode === 'invalid-result') structuredContent.extra = 'PRIVATE_UNCHECKED';
    send(message.id, { structuredContent, content });
  }
});
