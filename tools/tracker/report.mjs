#!/usr/bin/env node
// Tracker report for «Sualver.az + Туалет».
// Reads Claude Code session logs (~/.claude/projects/<cwd>/<session>.jsonl and its subagents/)
// and counts tokens, API-equivalent cost, models and time since the last posted report.
//
//   node tools/tracker/report.mjs draft [--transcript <path>] [--since <iso>]   print and save a draft
//   node tools/tracker/report.mjs mark                                            mark the saved draft as posted
//   node tools/tracker/report.mjs hook                                            PostToolUse hook (reads JSON from stdin)
//   node tools/tracker/report.mjs shot <url> <out.png> [--width 390] [--height 844] [--dark] [--full]  screenshot with the repo's Playwright
//
// No dependencies (shot uses the repository's own Playwright). Works on Windows, macOS and Linux with Node 18+.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// $ per 1M tokens: [input, output, cache read]. Cache write: 5m = 1.25 × input, 1h = 2 × input.
// Source: Claude API pricing table, cached 2026-11-03. Cache read defaults to 0.1 × input.
const PRICES = {
  "claude-fable-5-2": [8, 40, 0.2], "claude-mythos-5-2": [8, 40, 0.2],
  "claude-fable-5-1": [10, 50], "claude-mythos-5-1": [10, 50], "claude-fable-5": [10, 50],
  "claude-opus-5-5": [4, 20, 0.2], "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25], "claude-opus-4-7": [5, 25], "claude-opus-4-6": [5, 25], "claude-opus-4-5": [5, 25],
  "claude-opus-4-1": [15, 75], "claude-opus-4": [15, 75],
  "claude-sonnet-5-5": [2, 10, 0.1], "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15], "claude-sonnet-4-5": [3, 15], "claude-sonnet-4": [3, 15],
  "claude-haiku-5-5": [0.1, 0.5], "claude-haiku-4-5": [1, 5], "claude-3-5-haiku": [0.8, 4],
};
const NAMES = {
  "claude-fable-5-2": "Fable 5.2", "claude-fable-5-1": "Fable 5.1", "claude-fable-5": "Fable 5",
  "claude-mythos-5-2": "Mythos 5.2", "claude-mythos-5-1": "Mythos 5.1",
  "claude-opus-5-5": "Opus 5.5", "claude-opus-5": "Opus 5", "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7", "claude-opus-4-6": "Opus 4.6", "claude-opus-4-5": "Opus 4.5",
  "claude-opus-4-1": "Opus 4.1", "claude-opus-4": "Opus 4",
  "claude-sonnet-5-5": "Sonnet 5.5", "claude-sonnet-5": "Sonnet 5", "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-sonnet-4-5": "Sonnet 4.5", "claude-sonnet-4": "Sonnet 4",
  "claude-haiku-5-5": "Haiku 5.5", "claude-haiku-4-5": "Haiku 4.5", "claude-3-5-haiku": "Haiku 3.5",
};
const IDLE_GAP_MS = 5 * 60 * 1000; // a pause longer than this does not count as active time

const baseModel = (id) => {
  const s = String(id || "").replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");
  return Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => s === k || s.startsWith(k + "-")) || s;
};

function costOf(model, u) {
  const p = PRICES[model];
  if (!p) return null;
  let [inp, out, read = inp * 0.1] = p;
  const promptSize = u.in + u.cw5 + u.cw1h + u.cr;
  if (model === "claude-haiku-5-5" && promptSize > 100_000) { inp = 0.5; out = 2.5; read = 0.05; }
  const k = u.fast ? 2 : 1;
  return (k * (u.in * inp + u.out * out + u.cw5 * inp * 1.25 + u.cw1h * inp * 2 + u.cr * read)) / 1e6;
}

function readJsonl(file) {
  const rows = [];
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return rows; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a line still being written */ }
  }
  return rows;
}

// One assistant reply is logged once per content block with the same message id; keep one copy.
function collectUsage(rows, role, sinceMs, untilMs, sink, stamps) {
  const seen = new Map();
  for (const r of rows) {
    const t = Date.parse(r.timestamp || "");
    if (!Number.isFinite(t) || t <= sinceMs || t > untilMs) continue;
    if (r.type === "user" || r.type === "assistant") stamps.push(t);
    if (r.type !== "assistant" || !r.message || !r.message.usage) continue;
    const m = r.message;
    if (!m.model || m.model === "<synthetic>") continue;
    const key = m.id || r.uuid;
    const prev = seen.get(key);
    if (!prev || (m.usage.output_tokens || 0) >= (prev.message.usage.output_tokens || 0)) seen.set(key, r);
  }
  for (const r of seen.values()) {
    const u = r.message.usage, model = baseModel(r.message.model);
    const cc = u.cache_creation || {};
    const cw1h = cc.ephemeral_1h_input_tokens || 0;
    const cw5 = cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens || 0) - cw1h);
    const row = { in: u.input_tokens || 0, out: u.output_tokens || 0, cw5, cw1h, cr: u.cache_read_input_tokens || 0, fast: u.speed === "fast" };
    const k = model + "|" + role;
    const acc = sink.get(k) || { model, role, in: 0, out: 0, cw5: 0, cw1h: 0, cr: 0, cost: 0, priced: true, replies: 0 };
    for (const f of ["in", "out", "cw5", "cw1h", "cr"]) acc[f] += row[f];
    const c = costOf(model, row);
    if (c === null) acc.priced = false; else acc.cost += c;
    acc.replies++;
    sink.set(k, acc);
  }
}

function git(cwd, args) {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

// Git Bash gives paths like /c/Users/...; Node on Windows would read them as C:\c\Users\...
const winPath = (p) => (process.platform === "win32" && /^\/[a-zA-Z]\//.test(p || "") ? p[1] + ":" + p.slice(2) : p);

// git@github.com:owner/name.git or https://github.com/owner/name(.git) -> owner/name
function githubRepo(remote) {
  const m = String(remote || "").match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
  return m ? m[1] : "";
}

function findRepoRoot(cwd) { return git(cwd, ["rev-parse", "--show-toplevel"]) || cwd; }

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }

function newestTranscript(cwd) {
  const dir = path.join(os.homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
  let best = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const st = fs.statSync(path.join(dir, f));
      if (!best || st.mtimeMs > best.mtime) best = { file: path.join(dir, f), mtime: st.mtimeMs };
    }
  } catch { /* no logs for this folder */ }
  return best && best.file;
}

export function buildDraft({ transcript, cwd, sinceIso, untilMs = Date.now() }) {
  const root = findRepoRoot(cwd);
  const cfg = readJson(path.join(root, ".claude", "tracker.json"), {});
  const local = readJson(path.join(root, ".claude", "tracker.local.json"), {});
  const state = readJson(path.join(root, ".claude", "tracker-state.local.json"), { sessions: {} });
  const sessionId = path.basename(transcript, ".jsonl");
  const mainRows = readJsonl(transcript);
  const firstMs = mainRows.map((r) => Date.parse(r.timestamp || "")).find(Number.isFinite) || untilMs;
  const sinceMs = sinceIso ? Date.parse(sinceIso) : (state.sessions[sessionId] || firstMs - 1);

  const sink = new Map(), stamps = [];
  collectUsage(mainRows, "main", sinceMs, untilMs, sink, stamps);
  const subDir = path.join(path.dirname(transcript), sessionId, "subagents");
  let subFiles = [];
  try { subFiles = fs.readdirSync(subDir).filter((f) => f.endsWith(".jsonl")); } catch { /* none */ }
  for (const f of subFiles) {
    const meta = readJson(path.join(subDir, f.replace(/\.jsonl$/, ".meta.json")), {});
    const role = "sub:" + (meta.agentType || "agent") + (meta.description ? ": " + meta.description : "");
    collectUsage(readJsonl(path.join(subDir, f)), role, sinceMs, untilMs, sink, stamps);
  }

  stamps.sort((a, b) => a - b);
  let activeMs = 0;
  for (let i = 1; i < stamps.length; i++) { const g = stamps[i] - stamps[i - 1]; if (g <= IDLE_GAP_MS) activeMs += g; }
  const startedAt = stamps[0] || sinceMs, finishedAt = stamps[stamps.length - 1] || untilMs;

  // Fold subagent rows of one model into one line per (model, purpose), main work first.
  const models = [...sink.values()].map((r) => ({
    model: r.model, name: NAMES[r.model] || r.model,
    purpose: r.role === "main" ? "основная работа" : "субагент " + r.role.slice(4),
    input: r.in, output: r.out, cacheWrite: r.cw5 + r.cw1h, cacheRead: r.cr,
    tokens: r.in + r.out + r.cw5 + r.cw1h + r.cr, cost: Math.round(r.cost * 100) / 100, priced: r.priced, replies: r.replies,
  })).sort((a, b) => (a.purpose === "основная работа" ? -1 : 0) - (b.purpose === "основная работа" ? -1 : 0) || b.cost - a.cost);

  const email = git(root, ["config", "user.email"]);
  const log = git(root, ["log", `--since=${new Date(startedAt).toISOString()}`, `--until=${new Date(finishedAt + 60000).toISOString()}`,
    ...(email ? [`--author=${email}`] : []), "--format=%H%x1f%s", "-n", "30"]);
  const repo = githubRepo(git(root, ["remote", "get-url", "origin"]));
  const commits = log ? log.split("\n").map((l) => {
    const [sha, subject] = l.split("\x1f");
    return { sha, subject, url: repo ? `https://github.com/${repo}/commit/${sha}` : "" };
  }) : [];
  // State before this step: parent of the oldest commit in it, or HEAD when nothing was committed yet.
  const oldest = commits[commits.length - 1];
  const base = (oldest && git(root, ["rev-parse", "--verify", "-q", oldest.sha + "^"])) || git(root, ["rev-parse", "HEAD"]);
  const branch = git(root, ["branch", "--show-current"]);

  return {
    project: cfg.project || null,
    person: local.person || process.env.TRACKER_PERSON || null,
    tracker: cfg.tracker || cfg.artifact || null,
    repo,
    branch,
    branchUrl: repo && branch ? `https://github.com/${repo}/tree/${branch}` : "",
    base,
    preview: cfg.preview || null,
    commits,
    usage: {
      sessionId, startedAt, finishedAt,
      wallMin: Math.round((finishedAt - startedAt) / 60000),
      activeMin: Math.round(activeMs / 60000),
      tokens: models.reduce((s, m) => s + m.tokens, 0),
      cost: Math.round(models.reduce((s, m) => s + m.cost, 0) * 100) / 100,
      allPriced: models.every((m) => m.priced),
      models,
    },
    _repoRoot: root,
  };
}

function saveDraft(d) {
  const file = path.join(d._repoRoot, ".claude", "tracker-draft.local.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  return file;
}

function markPosted(cwd) {
  const root = findRepoRoot(cwd);
  const d = readJson(path.join(root, ".claude", "tracker-draft.local.json"), null);
  if (!d) { console.error("No draft to mark. Run `report.mjs draft` first."); process.exit(1); }
  const file = path.join(root, ".claude", "tracker-state.local.json");
  const state = readJson(file, { sessions: {} });
  state.sessions[d.usage.sessionId] = d.usage.finishedAt;
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  console.log(`Marked: next report for session ${d.usage.sessionId} starts after ${new Date(d.usage.finishedAt).toISOString()}`);
}

const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));
function summary(d) {
  const u = d.usage;
  const lines = [
    `Проект: ${d.project || "?"}, человек: ${d.person || "не задан"}, ветка ${d.branch || "?"}`,
    `Время: ${u.activeMin} мин активной работы, ${u.wallMin} мин от начала до конца, завершено ${new Date(u.finishedAt).toLocaleString("ru-RU")}`,
    `Токены: ${fmtTokens(u.tokens)}, по ценам API $${u.cost.toFixed(2)}${u.allPriced ? "" : " (есть модели без цены)"}`,
    ...u.models.map((m) => `  ${m.name}, ${m.purpose}: ${fmtTokens(m.tokens)}, $${m.cost.toFixed(2)}`),
    `Коммиты: ${d.commits.length ? d.commits.map((c) => c.sha.slice(0, 7) + " " + c.subject).join("; ") : "нет"}`,
    `Состояние «до»: ${d.base ? d.base.slice(0, 7) : "?"} (для снимков «до», если их не сняли в начале)`,
  ];
  return lines.join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

if (cmd === "draft") {
  const cwd = process.cwd();
  const transcript = opt("--transcript") || newestTranscript(findRepoRoot(cwd)) || newestTranscript(cwd);
  if (!transcript) { console.error("Session log not found. Pass --transcript <path to .jsonl>."); process.exit(1); }
  const d = buildDraft({ transcript, cwd, sinceIso: opt("--since"), untilMs: opt("--until") ? Date.parse(opt("--until")) : Date.now() });
  const file = saveDraft(d);
  console.log(summary(d));
  console.log(`\nDraft: ${file}`);
} else if (cmd === "mark") {
  markPosted(process.cwd());
} else if (cmd === "hook") {
  const input = JSON.parse((await readStdin()) || "{}");
  const command = String(input.tool_input && input.tool_input.command || "");
  const failed = input.tool_response && (input.tool_response.interrupted || /\b(rejected|fatal:|error:)/i.test(String(input.tool_response.stderr || "")));
  if (!/\bgit\b[^|;&\n]*\bpush\b/.test(command) || !input.transcript_path || failed) process.exit(0);
  const given = winPath(input.cwd);
  const cwd = given && fs.existsSync(given) ? given : process.cwd();
  const d = buildDraft({ transcript: winPath(input.transcript_path), cwd });
  const file = saveDraft(d);
  const context = [
    "Push done. Post an update to the shared tracker «Sualver.az + Туалет» now, following tools/tracker/README.md.",
    "If the change is visible on screen, the update needs a before and an after screenshot of the same screen (README, section Screenshots). Take the after shot now with `node tools/tracker/report.mjs shot`.",
    `Draft with real numbers from this session's logs: ${file}`,
    summary(d),
    d.person ? "" : "Person is not set: ask the user whether they are Руслан or Сеймур and write {\"person\":\"ruslan\"} or {\"person\":\"seymur\"} to .claude/tracker.local.json, then run the draft again.",
  ].filter(Boolean).join("\n");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }));
} else if (cmd === "shot") {
  // node tools/tracker/report.mjs shot <url> <out.png> [--width 390] [--height 844] [--wait 800] [--dark] [--full]
  const valued = ["--width", "--height", "--wait"];
  const [url, out] = rest.filter((a, i) => !a.startsWith("--") && !valued.includes(rest[i - 1]));
  if (!url || !out) { console.error("Usage: report.mjs shot <url> <out.png> [--width 390] [--height 844] [--wait 800] [--dark] [--full]"); process.exit(1); }
  await shot(url, path.resolve(out));
} else {
  console.log("Usage: report.mjs draft [--transcript <path>] [--since <iso>] | mark | hook | shot <url> <out.png>");
}

async function shot(url, out) {
  const root = findRepoRoot(process.cwd());
  let pw;
  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    pw = await import(pathToFileURL(createRequire(path.join(root, "package.json")).resolve("playwright")).href);
  } catch { console.error("Playwright is not installed in this repository. Run npm install, or take the screenshot with another browser tool."); process.exit(1); }
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  let browser;
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: "msedge" }); }
  const width = Number(opt("--width")) || 390, height = Number(opt("--height")) || 844;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: rest.includes("--dark") ? "dark" : "light" });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(Number(opt("--wait")) || 800);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: rest.includes("--full") });
  await browser.close();
  console.log(`Saved ${out} (${width}×${height})`);
}
