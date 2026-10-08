"use strict";
const { createReceiver } = require("./receiver.cjs");
const { runClient } = require("./client.cjs");
const { json } = require("./protocol.cjs");
// Local loopback only. Native principal/Job observations are tested as models separately.
const watchdog = setTimeout(() => process.exit(2), 15000);
async function main() {
  let receiver;
  try {
    receiver = await createReceiver();
    const client = await runClient(receiver.endpoint);
    const receipt = await receiver.close();
    if (
      !client.loopbackControlsComplete ||
      !receipt.closed ||
      receipt.receiverError
    )
      throw new Error("local-loopback-refused");
    process.stdout.write(
      json({
        endpoint: receiver.endpoint,
        client,
        receiver: { type: "closed", receipt },
      }) + "\n",
    );
  } catch {
    process.exitCode = 2;
  } finally {
    if (receiver) await receiver.close();
    clearTimeout(watchdog);
  }
}
void main();
