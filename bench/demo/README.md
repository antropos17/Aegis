# Evidence-chain capture

`evidence-chain.js` records, on screen, the one thing AEGIS claims: an independent
chain from an agent instance, to access of a sensitive file, to an outbound
connection, completed as a sequence detection — all observed by the sensor and
attributed from the OS, with no cooperation from the staged process.

It runs the real app from source against a staged process, captures the screen,
and writes four artifacts under `docs/media/`. It is not a marketing render.

## What is staged

A copy of the Node interpreter, placed under a name the agent database already
recognises, so the process sensor treats it as an agent instance. The name is
one for which no live process exists on the capture machine, so the agent card
shows this instance alone rather than folding it into an unrelated real agent.

That staged process does two things and nothing else:

- it holds one **synthetic file** open — inert bytes, seeded into a run-scoped
  home inside the OS temp directory. It is never a real credential, and it is
  never the developer's real home. What makes it sensitive to AEGIS is the name
  matching a rule the product already ships, not its content.
- it keeps **one outbound connection** alive to a public host.

## What is shown

- `still-1-agent.png` — the agent card for the staged instance appears.
- `still-2-file.png` — the sensitive line appears in the activity feed, attributed
  to that instance from the holder PID.
- `still-3-detection.png` — the anomaly toast, with the staged agent's card in frame.
- `evidence-chain.gif` — the real-time tail of the run, ending on the detection toast.

The GIF and stills carry no captions, no overlays, and no text written into the
image. What each shows is described here, in prose, not on the pixels.

## What is not shown, stated plainly

- **There is no dedicated "sequence" row in the feed or the timeline.** By design,
  the timeline shows neither the sequence detection nor the plain anomaly alert.
  The completed sequence surfaces on screen as the anomaly toast, and in the audit
  log as a `sequence-detection` record.
- **The card in these artifacts is green; since PR #333 it would not be.** The
  card's risk _badge_ comes from the risk-scoring model, which does not fold the
  sequence score into the risk score — a single synthetic hold plus a single
  outbound connection does not reach the danger band, so the badge stays in its
  ordinary band, and that is still true. What #333 changed is the card's alert
  state: a card whose instance crosses the anomaly toast threshold
  (`ANOMALY_TOAST_THRESHOLD`, the same gate the toast itself uses) now carries
  the danger border while the badge keeps showing the exposure band. The four
  artifacts under `docs/media/` were recorded before that change and show the
  card green beside the toast. Nothing was staged to force a colour the model
  would not produce, and the recording has not been redone.
- **Nothing here is an attack.** The synthetic file is inert; the connection is a
  benign keep-alive to a public host, not exfiltration. The recording shows what
  is observed and attributed, and claims nothing more.

## The manual step

If the installed AEGIS is running in the tray, close it (quit from the tray)
before the run: it holds the single-instance lock and a shared window that a dev
launch would collide with. On the recorded run the installed instance was not
running, so no manual step was needed. The dev launch itself uses an isolated
profile in the temp directory and never touches the installed instance's data.

## How to rerun

Windows only (the file-hold detection is a Restart Manager path). From the
worktree root:

```
node bench/demo/evidence-chain.js
```

It builds the renderer if the bundle is missing, launches AEGIS under an
inspector on an isolated profile, waits for the scan cadence to settle, spawns
the staged process, records the chain, encodes the GIF under the size ceiling
walking down a width-then-colours-then-frame-rate ladder, and tears everything
down. It leaves nothing behind but the four artifacts under `docs/media/`: the
temp profile, the run-scoped home, the staged binary and the synthetic file are
all removed on the way out.

If the detection does not close within the deadline, the run prints the timeline
of what did fire and stops. It never fabricates a frame.
