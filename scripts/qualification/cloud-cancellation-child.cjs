'use strict';

// The owner must observe this process alive and retain its native identity.
setTimeout(() => process.exit(126), 20000);
