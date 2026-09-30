'use strict';

// Only preloaded by disposable native fixtures. Expose the create-before-write
// window deterministically; production endpoint permissions and checks still run.
const fs = require('node:fs/promises');
const endpoint = require('../../src/main/action-mcp-endpoint');
endpoint._setDepsForTest({
  open: async (...args) => {
    const handle = await fs.open(...args);
    return {
      stat: () => handle.stat(),
      close: () => handle.close(),
      writeFile: async (bytes) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await handle.writeFile(bytes);
      },
    };
  },
});
