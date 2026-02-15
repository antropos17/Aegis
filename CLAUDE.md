# AEGIS — AI Agent Privacy Shield

> "The only door between AI and your life."

## What This Is

Consumer desktop app that monitors AI agents (Claude Code, Copilot, Cursor, Manus, Devin, etc.) running on user's local PC. Tracks file access, network activity, process behavior. Shows real-time dashboard with risk scoring.

**Key insight:** All competitors (Lasso, PromptArmor, Prompt Security, Nightfall, WitnessAI) are enterprise B2B — they monitor what humans send to AI. Nobody monitors what AI agents do on local machines. AEGIS fills this gap.

## Tech Stack

- **Framework:** Electron 33
- **Frontend:** Vanilla JS + CSS (no React, no build step)
- **File watching:** chokidar@3
- **Process detection:** `tasklist /fo csv` (Windows), `ps aux` (Mac/Linux)
- **Config storage:** JSON file at `~/.aegis/config.json`
- **Build:** electron-builder (NSIS installer for Windows)
- **Fonts:** Plus Jakarta Sans (headings) + DM Sans (body) + DM Mono (code/data)
- **No frameworks:** No React, no Tailwind, no webpack. Pure vanilla for zero dependencies.

## Project Structure

```
aegis-mvp/
├── package.json
├── CLAUDE.md              ← you are here
├── README.md
├── assets/                # Icons, images
│   └── icon.png
├── src/
│   ├── main/
│   │   ├── main.js        # Electron main process (577 lines)
│   │   └── preload.js     # Secure IPC bridge (35 lines)
│   ├── renderer/
│   │   ├── index.html     # Dashboard HTML shell (123 lines)
│   │   ├── app.js         # Dashboard logic + rendering (621 lines)
│   │   └── styles.css     # Theme + all component styles (492 lines)
│   └── shared/
│       └── constants.js   # Shared config (49 lines)
```

Total: ~1,900 lines across 6 files.

## Architecture

### Main Process (main.js)
- Sandbox directory creation at `~/.aegis/sandbox/`
- chokidar watchers on sensitive paths (SSH, .env, browser data, AWS, etc.)
- Process scanning every 30 seconds via tasklist/ps
- Agent detection matching against known signatures (7 agents + wildcard)
- IPC handlers for renderer communication
- System tray with context menu
- Activity log (append to `~/.aegis/activity.log`)
- Config persistence (JSON)

### Preload (preload.js)
- contextBridge exposes `window.aegis` API
- Methods: getState, updateConfig, togglePath, setAgentStatus, openSandbox, rescanAgents, addToSandbox, selectFiles, exportLog
- Event listener: onEvent (real-time events from main)

### Renderer (app.js + index.html + styles.css)
- 4 views: Shield (radar), Agents (cards), Rules (toggles), Activity (log)
- Tab navigation
- Demo mode when running outside Electron (simulates events)
- Canvas-based radar with sweep animation
- System nodes positioned around radar
- SVG connection lines for events
- Agent sidebar with trust grades
- Live event feed
- Rules panel with protection presets (Paranoid/Strict/Balanced/Developer)
- Shield score calculation
- CSV export

### IPC Flow
```
Renderer                    Main Process
   │                            │
   ├──aegis:getState──────────►│ Returns config, agents, events
   ├──aegis:updateConfig──────►│ Saves + restarts watchers
   ├──aegis:togglePath────────►│ Toggle blocked path
   ├──aegis:setAgentStatus───►│ Override agent status
   ├──aegis:rescanAgents─────►│ Force process scan
   ├──aegis:openSandbox──────►│ shell.openPath
   ├──aegis:selectFiles──────►│ dialog.showOpenDialog
   ├──aegis:exportLog────────►│ dialog.showSaveDialog + write CSV
   │                            │
   │◄──aegis:event────────────┤ Real-time file/process events
```

## Known AI Agent Signatures

main.js detects these by process name:
- claude, claude-code, claude.exe → Claude Code
- copilot, github-copilot, copilot-agent → GitHub Copilot
- codex, openai-codex → OpenAI Codex
- cursor, Cursor.exe, cursor-agent → Cursor AI
- devin, devin-agent → Devin
- manus, manus-ai → Manus AI
- windsurf, codeium → Windsurf

Plus wildcard detection for unknown agents with AI-related process names.

## Sensitive Paths Monitored

Defined in main.js SENSITIVE_PATHS:
- `~/.ssh/` — critical
- `~/.env*` — critical (regex pattern)
- Chrome User Data — critical
- Edge User Data — high
- `~/Documents/` — medium
- `~/Downloads/` — medium
- `~/Desktop/` — low
- `~/.gitconfig` — high
- `~/.npmrc` — high
- `~/.aws/` — critical

## Design System — Neumorphism

We are transitioning from dark cyberpunk to neumorphism. Step 1 (base theme variables) is done in styles.css but the visual implementation is incomplete.

### Design Tokens
```css
--bg: #E0E5EC;
--shadow-dark: rgba(163,177,198,0.6);
--shadow-light: rgba(255,255,255,0.8);
--accent: #4ECDC4;
--red: #E53E3E;      /* critical */
--orange: #ED8936;   /* high */
--blue: #4299E1;     /* medium */
--green: #38A169;    /* low / safe */
--text: #2D3748;
--text-mid: #5A6577;
--text-dim: #8896A6;
```

### Neumorphism Patterns
```css
/* Raised element */
box-shadow: 6px 6px 14px rgba(163,177,198,0.6),
           -6px -6px 14px rgba(255,255,255,0.8);

/* Pressed/inset element */
box-shadow: inset 4px 4px 8px rgba(163,177,198,0.6),
            inset -4px -4px 8px rgba(255,255,255,0.8);

/* Convex (button-like) */
background: linear-gradient(145deg, #F0F4F8, #D1D9E6);
box-shadow: 6px 6px 14px rgba(163,177,198,0.6),
           -6px -6px 14px rgba(255,255,255,0.8);
```

### Typography
- **Headings:** Plus Jakarta Sans, weight 700-800
- **Body/UI:** DM Sans, weight 400-600
- **Data/Code:** DM Mono, weight 400-500
- **Spacing:** letter-spacing: 2-3px for labels, -0.5px for large headings

### Color Usage
- Severity critical → red (#E53E3E)
- Severity high → orange (#ED8936)
- Severity medium → blue (#4299E1)
- Severity low → green (#38A169)
- Accent/brand → teal (#4ECDC4)
- Status active → green
- Status sandboxed → orange
- Status blocked → red

## What's Done (Features Working)

- [x] Detection of 13 AI agents + wildcard matching
- [x] File monitoring (40+ sensitive patterns via chokidar)
- [x] Network monitoring (DNS reverse lookup, known domains)
- [x] Risk scoring per agent
- [x] System tray + native notifications
- [x] Export reports (JSON/CSV/HTML)
- [x] Settings panel
- [x] Module A: AI analysis via Anthropic API
- [x] Module B: Behavior baselines with deviation warnings
- [x] 4 views: Shield, Agents, Rules, Activity Log
- [x] Demo mode (browser, no Electron)
- [x] Protection presets (Paranoid/Strict/Balanced/Developer)
- [x] Shield score + streak system
- [x] Step 1: Base neumorphism theme variables

## Roadmap (What's NOT Done)

### UI/UX Redesign
- [ ] Step 2: Central radar with process orbit animations, connection lines, node pulses
- [ ] Step 3: Two-column layout refinement
- [ ] Step 4: Header + footer + settings panel polish
- [ ] Step 5: Risk scoring formula upgrade (weighted, time-decay)

### Features
- [ ] Module C: Permissions UI (toggles per agent per resource, monitoring only — no enforcement)
- [ ] Block numbering system for entire codebase (BLOCK-M001, R001, S001 format)

### Launch Prep
- [ ] README.md rewrite (GIF demo, badges, proper install instructions)
- [ ] CONTRIBUTING.md
- [ ] SECURITY.md
- [ ] ARCHITECTURE.md (detailed)
- [ ] GitHub Issues (20+ covering roadmap items)
- [ ] GitHub Releases (alpha → beta → v0.1.0)
- [ ] GitHub Actions (CI/CD, auto-build)

### Grant Applications
- [ ] OpenAI Cybersecurity Grant — $10K, rolling basis, 3000 words plaintext
- [ ] NRC IRAP — up to $50K for Canadian small business
- [ ] RAII — $250K-$5M (needs 50% co-funding)

## Positioning

### Consumer Layer
Free open-source desktop monitor for developers. MIT license. "Antivirus but for AI agents."

### Government Layer
Canadian AI Agent Audit Platform — sovereign visibility into foreign AI agents operating on Canadian systems. Aligns with Canadian AI & Data Act (AIDA).

### Competitors (all enterprise B2B, different focus)
- **Lasso Security** — monitors AI app usage in orgs
- **PromptArmor** — prompt injection defense
- **Prompt Security** — DLP for AI tools
- **Nightfall AI** — data loss prevention
- **WitnessAI** — AI usage governance

None of them monitor what agents DO on local machines. That's AEGIS.

## Monetization Path
1. OpenAI Cybersecurity Grant ($10K) — apply after GitHub launch
2. NRC IRAP ($50K) — Canadian small business R&D funding
3. Pre-seed angels after traction (GitHub stars + HN post)
4. RAII ($250K-$5M) — later, needs co-funding

## Code Conventions

- No semicolons in CSS custom properties
- Use `const` over `let` when possible
- Template literals for HTML generation in app.js
- IPC channel names: `aegis:camelCase`
- Event severity levels: critical > high > medium > low
- CSS class naming: `component-element` pattern (e.g., `agent-card`, `feed-item`)
- Comments: `// ═══ SECTION NAME ═══` for major sections, `// ─── subsection ───` for minor
- All user-facing text in UPPERCASE for labels, Title Case for names

## Important Notes

- The app currently MONITORS only — it does NOT enforce/block anything at OS level. True blocking requires kernel-level hooks (Minifilter on Windows, Endpoint Security on Mac, eBPF on Linux). This is post-MVP.
- Demo mode in app.js simulates events when running outside Electron (for development/showcase).
- The README.md currently overstates capabilities — describes sandbox enforcement as if it's working. Needs rewrite before public launch.
- Process detection is Windows-focused (tasklist). Mac/Linux support (ps aux) is partially implemented.
- chokidar watches detect file changes but cannot attribute them to specific processes. True per-process attribution needs ETW (Windows) or fanotify (Linux).

## Related Ideas (Separate Projects)

- **CodeMap / RepoLens** — Interactive visualizer for open-source projects with AI explanations of code blocks
- **Privacy Presets** — Firefox browser extension for one-click privacy configuration through preset modes
