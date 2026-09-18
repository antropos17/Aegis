import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  observeReviewPreview,
  observeNegativeAnswer,
} from '../../scripts/claude-review-observer.mjs';

const prefix = 'AEGIS terminal confirmation - ONE launch\n';
const suffix = '\nType RUN abcdef01 to launch once within 60 seconds. Any other answer denies.\n> ';
const preview = prefix + '{"PRIVATE":"fixture"}' + suffix;
function setup(write) {
  let callback;
  const output = {
    write: vi.fn(
      write ||
        function (...args) {
          callback = args.at(-1);
          return false;
        },
    ),
  };
  const original = output.write;
  const notify = vi.fn();
  const restore = observeReviewPreview(output, notify);
  return { output, original, notify, restore, complete: (...args) => callback(...args) };
}

it.each(['string', 'buffer', 'encoding', 'undefined-encoding', 'no-callback'])(
  'preserves the %s write overload and notifies only after completion',
  (kind) => {
    const t = setup();
    const cb = vi.fn(() => expect(t.notify).not.toHaveBeenCalled());
    const chunk = kind === 'buffer' ? Buffer.from(preview) : preview;
    const args =
      kind === 'encoding'
        ? [chunk, 'utf8', cb]
        : kind === 'undefined-encoding'
          ? [chunk, undefined, cb]
          : kind === 'no-callback'
            ? [chunk]
            : [chunk, cb];
    expect(t.output.write(...args)).toBe(false);
    expect(t.original.mock.contexts[0]).toBe(t.output);
    expect(t.original.mock.calls[0][0]).toBe(chunk);
    if (kind === 'encoding') expect(t.original.mock.calls[0][1]).toBe('utf8');
    expect(t.notify).not.toHaveBeenCalled();
    t.complete();
    expect(t.notify).toHaveBeenCalledExactlyOnceWith();
    if (kind !== 'no-callback') expect(cb).toHaveBeenCalledExactlyOnceWith();
    t.restore();
    expect(t.output.write).toBe(t.original);
  },
);

it('preserves original callback receiver and arguments', () => {
  const receiver = {};
  const t = setup(function (_chunk, callback) {
    callback.call(receiver, null, 'extra');
    return true;
  });
  const cb = vi.fn();
  expect(t.output.write(preview, cb)).toBe(true);
  expect(cb.mock.contexts[0]).toBe(receiver);
  expect(cb).toHaveBeenCalledWith(null, 'extra');
  expect(t.notify).toHaveBeenCalledExactlyOnceWith();
});

it.each([
  prefix + '{}',
  '{}' + suffix,
  preview + 'extra',
  preview.replace('abcdef01', 'ABCDEF01'),
  prefix + 'x'.repeat(16384) + suffix,
])('ignores incomplete or oversized writes %#', (text) => {
  const t = setup();
  const cb = vi.fn();
  t.output.write(text, cb);
  expect(t.original).toHaveBeenCalledWith(text, cb);
  t.complete();
  expect(t.notify).not.toHaveBeenCalled();
});

it('does not assemble private fragments across writes', () => {
  const t = setup();
  t.output.write(prefix, () => {});
  t.complete();
  t.output.write('{}' + suffix, () => {});
  t.complete();
  expect(t.notify).not.toHaveBeenCalled();
});

it('accepts the exact byte cap and evaluates the actual encoding', () => {
  const t = setup();
  t.output.write(prefix + 'x'.repeat(16384 - Buffer.byteLength(prefix + suffix)) + suffix);
  t.complete();
  expect(t.notify).toHaveBeenCalledTimes(1);
  t.output.write(preview, 'utf16le', () => {});
  t.complete();
  expect(t.notify).toHaveBeenCalledTimes(1);
});

it('forwards failed callbacks without notifying', () => {
  const t = setup();
  const error = Error('PRIVATE_WRITE_ERROR');
  const cb = vi.fn();
  t.output.write(preview, cb);
  t.complete(error);
  expect(cb).toHaveBeenCalledWith(error);
  expect(t.notify).not.toHaveBeenCalled();
});

it.each([false, true])('preserves a write throw after synchronous callback=%s', (complete) => {
  const error = Error('PRIVATE_WRITE_THROW');
  const t = setup(function (_chunk, cb) {
    if (complete) cb();
    throw error;
  });
  expect(() => t.output.write(preview, () => {})).toThrow(error);
  expect(t.notify).not.toHaveBeenCalled();
});

it('preserves original callback exceptions and does not notify', () => {
  const t = setup();
  const error = Error('PRIVATE_CALLBACK_ERROR');
  t.output.write(preview, () => {
    throw error;
  });
  expect(() => t.complete()).toThrow(error);
  expect(t.notify).not.toHaveBeenCalled();
});

it('does not let observer errors affect the original write', () => {
  const t = setup(function (_chunk, cb) {
    cb();
    return 'original-return';
  });
  t.notify.mockImplementation(() => {
    throw Error('OBSERVER');
  });
  expect(t.output.write(preview, () => {})).toBe('original-return');
});

it('disables late callbacks on restore and does not overwrite another wrapper', () => {
  const t = setup();
  t.output.write(preview, () => {});
  const replacement = vi.fn();
  t.output.write = replacement;
  t.restore();
  t.complete();
  expect(t.notify).not.toHaveBeenCalled();
  expect(t.output.write).toBe(replacement);
});

it('restores inherited write without leaving an own property', () => {
  const original = vi.fn();
  const output = Object.create({ write: original });
  const restore = observeReviewPreview(output, vi.fn());
  restore();
  restore();
  expect(Object.hasOwn(output, 'write')).toBe(false);
  expect(output.write).toBe(original);
});

it.each([['no\n'], ['no\r'], ['no\r\n'], ['n', 'o', '\n'], ['no', '\r', '\n']])(
  'observes exact negative input split as %j',
  (...chunks) => {
    const input = new EventEmitter();
    const existing = vi.fn();
    input.on('data', existing);
    input.pause = vi.fn();
    input.resume = vi.fn();
    const observer = observeNegativeAnswer(input);
    chunks.forEach((chunk, i) => input.emit('data', i % 2 ? Buffer.from(chunk) : chunk));
    expect(observer.stop()).toBe(true);
    expect(observer.stop()).toBe(true);
    expect(input.listeners('data')).toEqual([existing]);
    expect(existing).toHaveBeenCalledTimes(chunks.length);
    expect(input.pause).not.toHaveBeenCalled();
    expect(input.resume).not.toHaveBeenCalled();
    expect(Object.keys(observer)).toEqual(['stop']);
  },
);

it.each([
  '',
  'no',
  'NO\n',
  ' no\n',
  'no \n',
  'no\nextra',
  'no\nno\n',
  'RUN abcdef01\n',
  'no\r\n\n',
  'no\n' + 'x'.repeat(128),
  '\u043do\n',
])('rejects incomplete, positive, multiline or extra input %#', (answer) => {
  const input = new EventEmitter();
  const observer = observeNegativeAnswer(input);
  input.emit('data', Buffer.from(answer));
  expect(observer.stop()).toBe(false);
  expect(input.listenerCount('data')).toBe(0);
});

it('invalidates an earlier negative when a later chunk contains extra text', () => {
  const input = new EventEmitter();
  const observer = observeNegativeAnswer(input);
  input.emit('data', 'no\n');
  input.emit('data', 'PRIVATE_EXTRA');
  expect(observer.stop()).toBe(false);
});

it('freezes the verdict after detaching and ignores unrelated earlier input', () => {
  const input = new EventEmitter();
  input.emit('data', 'PRIVATE_EARLIER');
  const observer = observeNegativeAnswer(input);
  input.emit('data', 'no\r');
  expect(observer.stop()).toBe(true);
  input.emit('data', 'PRIVATE_LATER');
  expect(observer.stop()).toBe(true);
});

it.each([55000, 60001])('rejects no arriving %s milliseconds after the preview', (elapsed) => {
  let now = 1000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const input = new EventEmitter();
    const observer = observeNegativeAnswer(input);
    now += elapsed;
    input.emit('data', 'no\n');
    expect(observer.stop()).toBe(false);
  } finally {
    clock.mockRestore();
  }
});

it('keeps a timely complete negative valid when stop happens after the deadline', () => {
  let now = 1000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const input = new EventEmitter();
    const observer = observeNegativeAnswer(input);
    now += 54999;
    input.emit('data', 'no\n');
    now += 60000;
    expect(observer.stop()).toBe(true);
  } finally {
    clock.mockRestore();
  }
});

it('rejects a split negative completed at the deadline', () => {
  let now = 1000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const input = new EventEmitter();
    const observer = observeNegativeAnswer(input);
    input.emit('data', 'no');
    now += 55000;
    input.emit('data', '\n');
    expect(observer.stop()).toBe(false);
  } finally {
    clock.mockRestore();
  }
});
