/** Child-only probe: exotic rejection belongs to its callback owner. */
'use strict';
const protocol = require(process.argv[2]);
const mode = process.argv[3];
if (
  !['own-then', 'constructor', 'species', 'constructor-shadowed', 'species-shadowed'].includes(mode)
)
  throw Error('Unknown probe');
let unhandled = 0;
let getterCalls = 0;
// The hook exists only in this disposable child, never in the production codec.
process.on('unhandledRejection', () => {
  unhandled++;
});
const rejected = Promise.reject(new Error('Synthetic probe rejection'));
if (mode === 'own-then')
  Object.defineProperty(rejected, 'then', {
    configurable: false,
    get() {
      getterCalls++;
      throw Error('Synthetic then getter');
    },
  });
if (mode.startsWith('constructor'))
  Object.defineProperty(rejected, 'constructor', {
    configurable: false,
    get() {
      getterCalls++;
      throw Error('Synthetic constructor');
    },
  });
if (mode.startsWith('species'))
  Object.defineProperty(rejected, 'constructor', {
    configurable: false,
    value: Object.defineProperty({}, Symbol.species, {
      configurable: false,
      get() {
        getterCalls++;
        throw Error('Synthetic species');
      },
    }),
  });
if (mode.endsWith('shadowed'))
  Object.defineProperty(rejected, 'then', { value: undefined, configurable: false });
const key = mode === 'own-then' ? 'then' : 'constructor';
const before = Object.getOwnPropertyDescriptor(rejected, key);
const decoder = protocol.createFrameDecoder({
  direction: 'sensor-to-host',
  onMessage: () => rejected,
});
const payload = Buffer.from('{"t":"ack","id":1}');
const bytes = Buffer.alloc(4 + payload.length);
bytes.writeUInt32LE(payload.length, 0);
payload.copy(bytes, 4);
const result = decoder.push(bytes);
setImmediate(() =>
  setImmediate(() => {
    const after = Object.getOwnPropertyDescriptor(rejected, key);
    console.log(
      JSON.stringify({
        mode,
        result,
        unhandled,
        getterCalls,
        descriptorUnchanged:
          before.get === after.get &&
          before.value === after.value &&
          before.configurable === after.configurable,
        terminal: decoder.finish(),
      }),
    );
  }),
);
