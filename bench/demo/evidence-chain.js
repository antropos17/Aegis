#!/usr/bin/env node
'use strict';

/**
 * @file bench/demo/evidence-chain.js
 * @description Scripted, reproducible capture of the AEGIS evidence chain for
 *   docs/media. It runs the real app from source against a staged process and
 *   records, on screen, the chain AEGIS attributes without the staged process
 *   cooperating:
 *
 *     agent instance  →  synthetic-file access  →  one outbound connection  →  SEQ001
 *
 *   WHAT IS STAGED. A copy of the Node interpreter under the name `aider.exe`
 *   (a name `src/shared/agent-database.json` recognises, so the process sensor
 *   stamps it `category: 'ai'` — `src/main/process-scanner.js`). `aider` is
 *   chosen because no live `aider` process exists on the capture machine, so the
 *   name-keyed agent card shows this instance alone rather than grouping it with
 *   an unrelated real agent. The staged process HOLDS one synthetic file
 *   (`~/.env.demo-credentials`, inert bytes, seeded into a run-scoped home in the
 *   OS temp directory — never a real secret and never the developer's real home)
 *   and KEEPS one outbound HTTPS connection to a public host. It is the staged
 *   process that acts; everything the record shows about it is observed by the
 *   sensor and attributed from the OS, not reported by the staged process.
 *
 *   WHAT FIRES. The hold is caught by the Restart Manager hot read-detect cycle
 *   as a `file-handle-held` event (attribution `rm-holder-pid`); the connection
 *   is caught by the network scan. Both carry the same instanceId, so the
 *   `temporal_ordered` engine completes SEQ001 ("Credential file read followed by
 *   outbound connection", `rules/sequences/sequences.yaml`). Its on-screen
 *   manifestation is the anomaly toast (the sequence score is 70, over the toast
 *   threshold of 50) plus the `sequence-detection` audit record. The agent
 *   card's risk band reflects `calculateRiskScore`, which does not fold the
 *   sequence score, so the card is NOT red from this chain alone — the still
 *   shows the toast with the staged agent's card in frame, and nothing is staged
 *   to force a colour the scoring model would not produce.
 *
 *   WHAT IS PRODUCED. `docs/media/evidence-chain.gif` (the real-time tail ending
 *   on the detection toast) and three PNG stills taken on real signals — the
 *   agent card appearing, the sensitive line appearing, and the toast. No
 *   captions, no overlays, no text is written into any artifact.
 *
 *   HOW IT IS CAPTURED. The app is launched with `--inspect`; over the main
 *   inspector the window is sized to 1200x800, a recorder is installed that
 *   writes `webContents.capturePage()` frames at 5 fps and takes the three
 *   stills when the renderer push carries each signal, and the GIF is encoded
 *   with `sharp` (already a devDependency; no ffmpeg on the machine). If the
 *   detection does not close within the deadline, the run reports the timeline
 *   of what fired and stops — it never fabricates a frame.
 *
 *   Nothing here is committed but the four artifacts under docs/media. The temp
 *   profile, the run-scoped home, the staged binary and the synthetic file are
 *   all removed on the way out.
 * @author AEGIS Contributors
 * @license MIT
 */

const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sharp = require('sharp');

/** @type {string} Worktree root (this file lives at bench/demo/). */
const ROOT = path.resolve(__dirname, '..', '..');

/** @type {string} The Electron executable path (a bare require in plain Node). */
const ELECTRON = require('electron');

/** @type {string} The renderer bundle the main window loads. */
const RENDERER_ENTRY = path.join(ROOT, 'dist', 'renderer', 'index.html');

/** @type {string} Node interpreter copied under an agent name to become the holder. */
const NODE_SOURCE = path.join(
  process.env.ProgramFiles || 'C:\\Program Files',
  'nodejs',
  'node.exe',
);

/** @type {number} Node inspector port for the main process. */
const INSPECT_PORT = 9229;

/** @type {number} Chromium remote-debugging port (opened for parity; unused here). */
const REMOTE_PORT = 9333;

/** @type {string} A public host to keep one 443 connection to. Not on any allowlist. */
const OUTBOUND_HOST = 'example.com';

/** @type {number} How long the holder holds the file and the socket, in ms. */
const HOLD_MS = 360000;

/** @type {number} Two process ticks under this gap ⇒ the scan cadence has settled. */
const STEADY_GAP_MS = 20000;

/** @type {number} How long to wait for the cadence to settle before giving up on it. */
const SETTLE_TIMEOUT_MS = 200000;

/** @type {number} How long after the holder spawns to wait for SEQ001, in ms. */
const DETECT_DEADLINE_MS = 240000;

/** @type {number} Frame interval — 200 ms is 5 fps. */
const FRAME_MS = 200;

/** @type {number} GIF window: this much before the detection instant. */
const GIF_LEAD_MS = 12000;

/** @type {number} GIF window: this much after the detection instant. */
const GIF_TAIL_MS = 1000;

/** @type {number} The 4 MB ceiling the GIF must come in under. */
const SIZE_CEILING = 4 * 1024 * 1024;

/**
 * The bytes the synthetic file holds — identical to `SEEDED_SECRET_BYTES` in
 * `bench/lib/actor.js` (which does not export it). Fixed and inert: nothing here
 * is a credential, and nothing about the CONTENT makes the file sensitive — the
 * directory and the name matching a rule the product already ships is what does.
 * @type {string}
 */
const SEEDED_SECRET_BYTES = ['{"bench":"seeded secret file — inert, not a credential"}', ''].join(
  '\n',
);

/** @type {RegExp} One completed process-scan tick, as the product logs it. */
const TICK_LINE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)]\s+DEBUG\s+\[scan]\s+process\b/;

/** @param {string} msg */
function log(msg) {
  console.log(`[evidence-chain] ${msg}`);
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the renderer if the bundle the main window loads is not there. The
 * deferred subsystems that own the sensors only start once a window has loaded
 * something, so a missing bundle is a run that observes nothing.
 * @returns {void}
 */
function buildRendererIfNeeded() {
  if (fs.existsSync(RENDERER_ENTRY)) {
    log('renderer bundle present');
    return;
  }
  log('renderer bundle missing — running npm run build:renderer');
  execFileSync('npm', ['run', 'build:renderer'], { cwd: ROOT, stdio: 'inherit', shell: true });
}

/**
 * Split a stream into lines and hand each to a sink.
 * @param {import('stream').Readable} stream
 * @param {(line: string) => void} onLine
 * @returns {void}
 */
function pumpLines(stream, onLine) {
  let carry = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const parts = (carry + chunk).split('\n');
    carry = parts.pop();
    for (const line of parts) onLine(line.replace(/\r$/, ''));
  });
}

/**
 * The instant a run of ticks first showed a settled cadence (two consecutive
 * ticks closer than `gapMs`).
 * @param {string[]} ticks
 * @param {number} gapMs
 * @returns {string|null}
 */
function settledAt(ticks, gapMs) {
  for (let i = 1; i < ticks.length; i++) {
    const gap = Date.parse(ticks[i]) - Date.parse(ticks[i - 1]);
    if (Number.isFinite(gap) && gap < gapMs) return ticks[i];
  }
  return null;
}

/**
 * Fetch the main process's inspector WebSocket URL, retrying until it answers.
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function waitForInspector(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const target = targets.find((t) => t.webSocketDebuggerUrl);
      if (target) return target.webSocketDebuggerUrl;
    } catch (_err) {
      /* inspector not up yet */
    }
    await sleep(500);
  }
  throw new Error(`main inspector on ${port} never answered within ${timeoutMs} ms`);
}

/**
 * A minimal CDP client over the inspector WebSocket.
 * @param {string} wsUrl
 * @returns {Promise<{send: (m: string, p?: object) => Promise<object>, close: () => void}>}
 */
function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    ws.addEventListener('open', () =>
      resolve({
        send: (method, params) =>
          new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params: params || {} }));
          }),
        close: () => ws.close(),
      }),
    );
    ws.addEventListener('error', () => reject(new Error('inspector WebSocket error')));
  });
}

/**
 * Evaluate an expression in the main process and return its value.
 * @param {{send: (m: string, p?: object) => Promise<object>}} client
 * @param {string} expression
 * @param {boolean} [awaitPromise]
 * @returns {Promise<*>}
 */
async function evaluate(client, expression, awaitPromise = false) {
  const r = await client.send('Runtime.evaluate', {
    expression,
    includeCommandLineAPI: true,
    returnByValue: true,
    awaitPromise,
  });
  if (r.exceptionDetails) {
    throw new Error(`main eval failed: ${JSON.stringify(r.exceptionDetails)}`);
  }
  return r.result ? r.result.value : undefined;
}

/**
 * The recorder + still-capturer, evaluated inside the Electron main process. It
 * sizes the window, records `capturePage` frames at 5 fps to disk, hooks the
 * renderer push, and takes the three stills when each signal actually arrives.
 * @param {{holderPid: number, framesDir: string, stillsDir: string, frameMs: number}} cfg
 * @returns {string} A source string for Runtime.evaluate.
 */
function controllerSource(cfg) {
  return `(() => {
  const CFG = ${JSON.stringify(cfg)};
  const path = require('path');
  const fs = require('fs');
  const { BrowserWindow } = require('electron');
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { globalThis.__demo = { err: 'no-window', done: true }; return 'no-window'; }
  const wc = win.webContents;
  const state = {
    startAt: Date.now(), holderPid: CFG.holderPid,
    agentSeenAt: null, fileSeenAt: null, detectAt: null,
    frames: 0, maxScore: 0, done: false, err: null,
  };
  globalThis.__demo = state;
  try {
    win.setContentSize(1200, 800);
    win.show(); win.moveTop(); win.focus(); win.setAlwaysOnTop(true);
  } catch (e) { state.err = 'resize: ' + (e && e.message); }

  let capturing = false;
  async function grab(file) {
    try { const img = await wc.capturePage(); fs.writeFileSync(file, img.toPNG()); return true; }
    catch (e) { state.err = 'capture: ' + (e && e.message); return false; }
  }
  const rec = setInterval(async () => {
    if (capturing || state.done) return;
    capturing = true;
    const ts = Date.now();
    const ok = await grab(path.join(CFG.framesDir, ts + '.png'));
    if (ok) state.frames += 1;
    capturing = false;
  }, CFG.frameMs);
  function still(name, delay, after) {
    setTimeout(async () => { await grab(path.join(CFG.stillsDir, name)); if (after) after(); }, delay);
  }

  const origSend = wc.send.bind(wc);
  wc.send = (channel, ...args) => {
    try {
      const p = args[0];
      if (channel === 'scan-batch' && p && Array.isArray(p.agents)) {
        const mine = p.agents.find((a) => a.pid === state.holderPid);
        if (mine && state.agentSeenAt === null) {
          state.agentSeenAt = Date.now();
          still('still-1-agent.png', 500);
        }
        if (mine && mine.instanceId && p.anomalyScoresByInstance) {
          const sc = p.anomalyScoresByInstance[mine.instanceId] || 0;
          if (sc > state.maxScore) state.maxScore = sc;
          if (sc >= 70 && state.detectAt === null) {
            state.detectAt = Date.now();
            still('still-3-detection.png', 700, () => {
              setTimeout(() => { clearInterval(rec); state.done = true; }, 400);
            });
          }
        }
      }
      if (channel === 'file-access') {
        const batch = Array.isArray(p) ? p : [p];
        const hit = batch.find((e) =>
          e && e.pid === state.holderPid && e.action === 'holding' && e.sensitive);
        if (hit && state.fileSeenAt === null) {
          state.fileSeenAt = Date.now();
          still('still-2-file.png', 500);
        }
      }
    } catch (e) { /* never break the app's own push */ }
    return origSend(channel, ...args);
  };
  return 'installed';
})()`;
}

/**
 * Kill a process tree on Windows, resolving even when it is already gone.
 * @param {number} pid
 * @returns {Promise<void>}
 */
function killTree(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
  });
}

/**
 * Remove a directory once Windows has released it — a killed holder can hold its
 * own image mapped for a moment after exit.
 * @param {string} dir
 * @returns {void}
 */
function removeWhenReleased(dir) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (_err) {
      const until = Date.now() + 100;
      while (Date.now() < until) {
        /* spin — the OS releases the handle, nothing here can await it */
      }
    }
  }
}

/**
 * Encode the GIF from the frame window ending on the detection, walking the size
 * ladder until it comes in under the ceiling: 720 px, then 600 px, then 64
 * colours, then 4 fps.
 * @param {string} framesDir
 * @param {number} detectAt
 * @param {string} outPath
 * @returns {Promise<{width: number, colours: number, fps: number, frames: number, bytes: number, over: boolean}>}
 */
async function encodeGif(framesDir, detectAt, outPath) {
  const all = fs
    .readdirSync(framesDir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => ({ f, ts: Number(f.replace('.png', '')) }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts);
  const lo = detectAt - GIF_LEAD_MS;
  const hi = detectAt + GIF_TAIL_MS;
  let frameWindow = all.filter((x) => x.ts >= lo && x.ts <= hi);
  if (frameWindow.length < 2) frameWindow = all.slice(-Math.round(GIF_LEAD_MS / FRAME_MS));
  const buffers = frameWindow.map((x) => fs.readFileSync(path.join(framesDir, x.f)));

  const rungs = [
    { width: 720, colours: 128, sub: 1, delay: 200, fps: 5 },
    { width: 600, colours: 128, sub: 1, delay: 200, fps: 5 },
    { width: 600, colours: 64, sub: 1, delay: 200, fps: 5 },
    { width: 600, colours: 64, sub: 2, delay: 250, fps: 4 },
  ];
  let last = null;
  for (const rung of rungs) {
    const chosen = rung.sub > 1 ? buffers.filter((_b, i) => i % rung.sub === 0) : buffers;
    // Resize each frame first so every frame shares one size before the join —
    // avoids any ambiguity in resizing an already-joined animation.
    const resized = await Promise.all(
      chosen.map((b) => sharp(b).resize({ width: rung.width }).png().toBuffer()),
    );
    await sharp(resized, { join: { animated: true } })
      .gif({
        delay: rung.delay,
        loop: 0,
        colours: rung.colours,
        interFrameMaxError: 8,
        dither: 0.5,
      })
      .toFile(outPath);
    const bytes = fs.statSync(outPath).size;
    last = {
      width: rung.width,
      colours: rung.colours,
      fps: rung.fps,
      frames: resized.length,
      bytes,
      over: bytes > SIZE_CEILING,
    };
    log(
      `gif rung ${rung.width}px/${rung.colours}c/${rung.fps}fps → ${(bytes / 1024).toFixed(0)} KB`,
    );
    if (bytes <= SIZE_CEILING) return last;
  }
  return last;
}

/** @returns {Promise<void>} */
async function main() {
  if (!fs.existsSync(NODE_SOURCE)) {
    throw new Error(`no Node interpreter to stage at ${NODE_SOURCE}`);
  }
  buildRendererIfNeeded();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const profileDir = path.join(os.tmpdir(), `aegis-demo-${stamp}-${process.pid}`);
  const homeDir = path.join(profileDir, 'home');
  const stageDir = path.join(profileDir, 'stage');
  const framesDir = path.join(profileDir, 'frames');
  const stillsDir = path.join(profileDir, 'stills');
  for (const d of [profileDir, homeDir, stageDir, framesDir, stillsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // Seed the synthetic file directly under the run-scoped home so the Restart
  // Manager's ~/.env* group registers it (a file-level group, so the held path
  // is the file itself and SEQ001's file step can match its name).
  const secretFile = path.join(homeDir, '.env.demo-credentials');
  fs.writeFileSync(secretFile, SEEDED_SECRET_BYTES, { flag: 'wx' });
  log(`seeded synthetic file ${secretFile}`);

  // Stage the interpreter under an agent name with no live instance.
  const stagedBinary = path.join(stageDir, 'aider.exe');
  fs.copyFileSync(NODE_SOURCE, stagedBinary, fs.constants.COPYFILE_EXCL);

  const env = { ...process.env, USERPROFILE: homeDir, HOME: homeDir };
  delete env.ELECTRON_RUN_AS_NODE;

  /** @type {import('child_process').ChildProcess | null} */
  let electron = null;
  /** @type {import('child_process').ChildProcess | null} */
  let holder = null;
  /** @type {{close: () => void} | null} */
  let cdp = null;
  let outcome = 'incomplete';

  try {
    log(`launching AEGIS (profile ${profileDir})`);
    electron = spawn(
      ELECTRON,
      [
        '.',
        `--user-data-dir=${profileDir}`,
        `--inspect=${INSPECT_PORT}`,
        `--remote-debugging-port=${REMOTE_PORT}`,
        '--force-device-scale-factor=1',
      ],
      { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    const ticks = [];
    let died = null;
    electron.on('exit', (code, signal) => {
      died = { code, signal };
    });
    const onLine = (line) => {
      const m = TICK_LINE.exec(line);
      if (m) ticks.push(m[1]);
    };
    pumpLines(electron.stdout, onLine);
    pumpLines(electron.stderr, onLine);

    // Wait for the scan cadence to settle (past the warmup schedule), so the
    // 10 s hot read-detect cycle is running before the holder acts.
    log('waiting for the scan cadence to settle');
    const settleDeadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (settledAt(ticks, STEADY_GAP_MS) === null) {
      if (died) throw new Error(`AEGIS exited before settling (code ${died.code})`);
      if (Date.now() > settleDeadline) {
        throw new Error(`cadence never settled within ${SETTLE_TIMEOUT_MS} ms`);
      }
      await sleep(1000);
    }
    log(`cadence settled after ${ticks.length} ticks`);

    // Spawn the holder: the staged binary holds the synthetic file open and keeps
    // ONE outbound connection alive. A self-healing persistent TLS socket, written
    // to every few seconds and reconnected the instant it closes, so the socket is
    // ESTABLISHED continuously — an idle TLS connection is torn down by the far end
    // in ~10-15 s and a 30 s network scan would sample the gap. Both are bounded by
    // the holder's own timeout, so nothing outlives the run.
    const holderScript = [
      "const tls=require('tls'),fs=require('fs');",
      'const file=process.argv[1],host=process.argv[2],ms=Number(process.argv[3]);',
      "fs.openSync(file,'r');",
      'let sock=null;',
      'function keep(){try{sock.write("HEAD / HTTP/1.1\\r\\nHost: "+host+"\\r\\nConnection: keep-alive\\r\\n\\r\\n");}catch(e){}}',
      'function connect(){sock=tls.connect(443,host,{servername:host},keep);',
      'sock.on("data",()=>{});sock.on("error",()=>{try{sock.destroy();}catch(e){}});',
      'sock.on("close",()=>{sock=null;});}',
      'connect();',
      'const iv=setInterval(()=>{if(!sock||sock.destroyed){connect();}else{keep();}},3000);',
      'setTimeout(()=>{clearInterval(iv);if(sock){try{sock.destroy();}catch(e){}}},ms);',
    ].join('');
    holder = spawn(stagedBinary, ['-e', holderScript, secretFile, OUTBOUND_HOST, String(HOLD_MS)], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const holderSpawnAt = Date.now();
    log(`holder spawned as aider.exe pid ${holder.pid} — holding file + one 443 connection`);

    // Install the recorder/still-capturer in the main process.
    const wsUrl = await waitForInspector(INSPECT_PORT, 30000);
    cdp = await connectCdp(wsUrl);
    await cdp.send('Runtime.enable');
    const installed = await evaluate(
      cdp,
      controllerSource({ holderPid: holder.pid, framesDir, stillsDir, frameMs: FRAME_MS }),
    );
    log(`controller ${installed}`);

    // Poll until SEQ001 closes or the deadline passes. Never fabricate a frame.
    const detectDeadline = holderSpawnAt + DETECT_DEADLINE_MS;
    let state = null;
    for (;;) {
      if (died) throw new Error(`AEGIS exited mid-run (code ${died.code})`);
      state = await evaluate(cdp, 'JSON.stringify(globalThis.__demo || null)');
      state = state ? JSON.parse(state) : null;
      if (state && state.done && state.detectAt) break;
      if (Date.now() > detectDeadline) {
        const rel = (t) => (t ? `${((t - holderSpawnAt) / 1000).toFixed(1)}s` : 'never');
        throw new Error(
          `SEQ001 did not close within ${DETECT_DEADLINE_MS / 1000}s of holder spawn. ` +
            `Timeline relative to spawn — agent card: ${rel(state && state.agentSeenAt)}, ` +
            `sensitive line: ${rel(state && state.fileSeenAt)}, ` +
            `detection: never; max instance score seen: ${state ? state.maxScore : 0}.`,
        );
      }
      await sleep(1000);
    }

    log('SEQ001 closed — encoding artifacts');
    const mediaDir = path.join(ROOT, 'docs', 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    for (const name of ['still-1-agent.png', 'still-2-file.png', 'still-3-detection.png']) {
      const src = path.join(stillsDir, name);
      if (!fs.existsSync(src)) throw new Error(`${name} was never captured`);
      fs.copyFileSync(src, path.join(mediaDir, name));
    }
    const gif = await encodeGif(
      framesDir,
      state.detectAt,
      path.join(mediaDir, 'evidence-chain.gif'),
    );

    const rel = (t) => `${((t - holderSpawnAt) / 1000).toFixed(1)}s`;
    log('─'.repeat(60));
    log(`agent card signal:   ${rel(state.agentSeenAt)} after holder spawn`);
    log(`sensitive line:      ${rel(state.fileSeenAt)} after holder spawn`);
    log(`SEQ001 detection:    ${rel(state.detectAt)} after holder spawn`);
    log(`frames recorded:     ${state.frames}`);
    log(
      `gif: ${gif.width}px / ${gif.colours} colours / ${gif.fps} fps / ` +
        `${gif.frames} frames / ${(gif.bytes / 1024 / 1024).toFixed(2)} MB` +
        (gif.over ? ' (OVER 4 MB — ladder exhausted)' : ''),
    );
    for (const name of [
      'evidence-chain.gif',
      'still-1-agent.png',
      'still-2-file.png',
      'still-3-detection.png',
    ]) {
      const bytes = fs.statSync(path.join(mediaDir, name)).size;
      log(`  ${name}  ${(bytes / 1024).toFixed(0)} KB`);
    }
    log('─'.repeat(60));
    outcome = gif.over ? 'gif-over-ceiling' : 'ok';
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch (_err) {
        /* socket already gone */
      }
    }
    if (holder && holder.exitCode === null && holder.signalCode === null) {
      await killTree(holder.pid);
    }
    if (electron && electron.exitCode === null && electron.signalCode === null) {
      await killTree(electron.pid);
      await sleep(1500);
    }
    removeWhenReleased(profileDir);
    log(`cleaned up temp profile — outcome: ${outcome}`);
  }

  if (outcome !== 'ok') process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[evidence-chain] FAILED — ${err.message}`);
  process.exitCode = 1;
});
