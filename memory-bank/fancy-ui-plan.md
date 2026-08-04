# FANCY AEGIS — Master Redesign Plan (v1)
> Created: March 3, 2026 | Target: v0.5.0-alpha
> Goal: Make Aegis look like enterprise EDR that happens to be open-source. Reddit/X wow-effect.

---

## VISION

When someone sees a screenshot of Aegis on r/programming or r/cybersecurity, the reaction should be: **"Wait, this is open-source? Built by one person?"**

We're not adding features. We're making the existing features **look and feel** like they belong in a $50K/yr enterprise EDR product. CrowdStrike Falcon visual quality, SentinelOne interactivity, Elastic Security data density — but with open-source soul and zero UI dependencies.

**One-liner**: "From functional prototype to visual masterpiece — same Svelte, same data, 10x the wow."

---

## CURRENT STATE (v0.4.0-alpha)

| What | Status |
|------|--------|
| Build | 1.20s, 201 modules, 0 errors |
| Tests | 489 pass, 4 skip, 28 files |
| Components | 35 Svelte 5 + 5 stores |
| Files >300 lines | 0 |
| UI libraries | NONE (pure Svelte + CSS) |
| Tabs | Shield, Activity, Rules, Reports, Stats |
| Design tokens | tokens.css (CSS vars) |
| Fonts | JetBrains Mono (code), system sans |
| Animations | Radar sweep (CSS), tab show/hide |

### What's Good (Keep)
- Glassmorphism (`backdrop-filter: blur(20px)`) 
- Grid layout on Shield
- Radar animation concept
- Dark theme (#0a0a0f base)
- No UI library dependency
- Clean component architecture (all <300 lines)
- Performance optimizations (boot 83% faster, tab switch <1ms)

### What's Bad (Fix)
- AgentCard = dry, no activity visualization
- Risk score = plain text number
- Activity feed = looks like log file
- Status bar = bare numbers (CPU 0%, MEM 130 MB)
- Tab bar = weak border, gets lost on dark bg
- No summary cards / overview metrics
- No micro-animations on interactions
- Typography = single font for everything
- No visual danger indicators on high-risk agents

### What's Missing (Add)
- Sparklines (activity over time per agent)
- Global Risk Ring / health indicator
- Summary cards (Active Agents, Events/hr, Threat Level)
- Hover spotlight effects
- Feed entry animations (fade-in, slide)
- Trust grade color badges (A+, B, C-)
- Danger border on high-risk agents
- Mini CPU/MEM charts in footer
- Tab switch transitions
- Typography hierarchy (display / body / mono)

---

## DESIGN SYSTEM UPDATE

### Color Palette
```css
/* Keep */
--bg:           #050507;         /* Deeper than current #0a0a0f */
--surface:      rgba(20, 20, 25, 0.6);
--surface-hover: rgba(30, 30, 40, 0.8);

/* Borders */
--border:           rgba(255, 255, 255, 0.08);
--border-highlight: rgba(255, 255, 255, 0.15);

/* Text */
--text-1: #ffffff;
--text-2: #8a8f98;

/* Semantic */
--accent:  #00ff88;    /* Laser Green — trust, healthy, secure */
--danger:  #ff3366;    /* Hot Red — threats, critical, kill */
--warning: #ff8800;    /* Amber — medium risk, caution */
--info:    #9aafcc;    /* Steel Blue — neutral info, agent names */
```

### Typography
```css
--font-title: 'Outfit', sans-serif;      /* Headers, brand, panel titles */
--font-body:  'DM Sans', sans-serif;      /* UI text, labels, buttons */
--font-mono:  'DM Mono', monospace;       /* Data, PIDs, timestamps, scores */
```
**Load from Google Fonts** — Outfit (500,600,700), DM Sans (400,500,600), DM Mono (400,500).
Keep JetBrains Mono in code/terminal contexts only.

### Glassmorphism Tokens
```css
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  backdrop-filter: blur(20px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),   /* top glint */
    0 8px 24px rgba(0, 0, 0, 0.4);               /* depth shadow */
}
.panel:hover {
  border-color: var(--border-highlight);
  background: var(--surface-hover);
}
```

### Animation Rules
```
ALWAYS: transform, opacity, filter (GPU composited)
NEVER: width, height, top, left, margin, padding (layout thrashing)
DURATION: micro 150ms, normal 300ms, dramatic 600ms
EASING: cubic-bezier(0.4, 0, 0.2, 1) — default
         cubic-bezier(0.34, 1.56, 0.64, 1) — bouncy for cards
```

### Spacing Grid
```
--space-xs: 4px;
--space-sm: 8px;
--space-md: 16px;
--space-lg: 24px;
--space-xl: 32px;
--space-2xl: 48px;
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 20px;
```

---

## COMPONENT PLAN

### New Components to Create

| Component | Purpose | Lines (est.) | Priority |
|-----------|---------|-------------|----------|
| `Sparkline.svelte` | Reusable SVG mini-chart (agent activity, CPU, MEM) | ~80 | MUST |
| `SummaryCards.svelte` | 3-4 metric cards at top of Shield | ~60 | MUST |
| `RiskRing.svelte` | Central SVG ring gauge with glow + pulse | ~120 | NICE |
| `TrustBadge.svelte` | Color-coded grade badge (A+, B, C-) | ~30 | SHOULD |
| `SpotlightCard.svelte` | Wrapper with radial gradient hover tracking | ~50 | SHOULD |
| `FeedTransition.svelte` | Animated wrapper for new feed entries | ~40 | SHOULD |

### Existing Components to Modify

| Component | Changes | Priority |
|-----------|---------|----------|
| `ShieldTab.svelte` | Bento grid layout (3-col: radar, overview+feed, agents) | MUST |
| `AgentCard.svelte` | Add sparkline, trust badge, danger border, spotlight hover | MUST |
| `Footer.svelte` | Mini sparkline charts for CPU/MEM, scan pulse | SHOULD |
| `TabBar.svelte` (or App.svelte) | Subtle glitch transition on tab switch | NICE |
| `GroupedFeedItem.svelte` | Severity color strip, fade-in animation | SHOULD |
| `AgentStatsPanel.svelte` | Summary cards row at top, inline sparklines | MUST |
| `tokens.css` | Full design system update (colors, fonts, spacing, glass tokens) | MUST |
| `global.css` | Google Fonts import, body bg gradient | MUST |

---

## IMPLEMENTATION PHASES

### Phase F1 — Foundation (tokens + layout) — ~2h
> Branch: `feat/fancy-ui`

**F1.1 — Design System Tokens** (30min)
- File: `tokens.css` + `global.css`
- Add all new CSS variables (colors, fonts, spacing, glass)
- Import Google Fonts (Outfit, DM Sans, DM Mono)
- Add subtle radial gradient to body background
- Add `--transition-micro`, `--transition-normal`, `--transition-dramatic` vars
- DO NOT break any existing component — additive only

**F1.2 — Bento Grid Shield Layout** (1h)
- File: `ShieldTab.svelte`
- Convert to CSS Grid: `grid-template-columns: 350px 1fr 380px; grid-template-rows: 250px 1fr;`
- Radar panel: left column, spans 2 rows
- Summary cards: top center
- Live feed: bottom center  
- Agent list: right column, spans 2 rows
- Wrap each section in `.panel` with new glass tokens
- Responsive: on narrow screens, stack vertically

**F1.3 — Summary Cards** (30min)
- New file: `SummaryCards.svelte`
- 3 cards: Active Agents (number), Events/hour (number), Threat Level (text + color)
- Data from existing stores (ipc store has agent count, events)
- Mono font for numbers, sans for labels
- Hover: border-highlight + slight translateY(-2px)

**Claude Code Prompt for F1:**
```
Прочитай .claude/skills/aegis-context/SKILL.md и CLAUDE.md.
Создай ветку feat/fancy-ui от master.

ЗАДАЧА: Phase F1 — Design System + Bento Grid Shield

F1.1: Обнови tokens.css — добавь новые CSS переменные (НЕ удаляй старые, только добавляй):
- Цвета: --bg: #050507, --surface: rgba(20,20,25,0.6), --surface-hover: rgba(30,30,40,0.8), --border: rgba(255,255,255,0.08), --border-highlight: rgba(255,255,255,0.15), --text-1: #fff, --text-2: #8a8f98, --accent: #00ff88, --danger: #ff3366, --warning: #ff8800, --info: #9aafcc
- Шрифты: --font-title: 'Outfit', sans-serif; --font-body: 'DM Sans', sans-serif; --font-mono: 'DM Mono', monospace
- Spacing: --space-xs: 4px через --space-2xl: 48px
- Radius: --radius-sm: 8px через --radius-xl: 20px
- Transitions: --transition-micro: 150ms, --transition-normal: 300ms, --transition-dramatic: 600ms
- Glass tokens: .panel class (surface bg, border, blur 20px, inset shadow)

В global.css: добавь @import для Google Fonts (Outfit 500-700, DM Sans 400-600, DM Mono 400-500). Добавь subtle radial gradients на body.

F1.2: Переделай ShieldTab.svelte в Bento Grid:
- CSS Grid 3 колонки: 350px 1fr 380px, 2 ряда: 250px 1fr
- Radar: grid-column 1, grid-row 1/span 2
- Summary cards: grid-column 2, grid-row 1
- Feed: grid-column 2, grid-row 2  
- Agents: grid-column 3, grid-row 1/span 2
- Каждая секция обёрнута в .panel

F1.3: Создай src/renderer/components/SummaryCards.svelte:
- 3 карточки в ряд (flexbox): Active Agents, Events/hr, Threat Level
- Берёт данные из существующих stores
- Шрифт: --font-mono для чисел, --font-body для label
- Hover: border-highlight + translateY(-2px), transition 300ms

ПРАВИЛА:
- Новые файлы = .svelte (компоненты) или .ts (утилиты)
- Максимум 300 строк на файл
- Все анимации: transform/opacity только (GPU)
- НЕ ломай существующий функционал
- После каждого шага: npm test && npm run build && npx tsc --noEmit
- Conventional commits: feat: redesign Shield tab with bento grid layout
```

---

### Phase F2 — Agent Cards Upgrade — ~2h
> Same branch: `feat/fancy-ui`

**F2.1 — Sparkline Component** (45min)
- New file: `Sparkline.svelte`
- Props: `data: number[]`, `color: string`, `width: number`, `height: number`
- Pure SVG `<polyline>` — no canvas, no libraries
- Optional: gradient fill below the line (subtle)
- Animate on mount: line draws left-to-right (CSS stroke-dashoffset trick)
- Reusable: will be used in AgentCard, Footer, Stats

**F2.2 — Trust Badge** (15min)
- New file: `TrustBadge.svelte`  
- Props: `grade: string` (A+, A, B, C, D, F), `size: 'sm' | 'md'`
- Color mapping: A+/A = accent green, B = info blue, C = warning amber, D/F = danger red
- Pill shape with subtle gradient background
- Font: --font-mono, weight 700

**F2.3 — Agent Card Redesign** (1h)
- File: `AgentCard.svelte`
- Add Sparkline component (last 60 data points from risk history)
- Add TrustBadge (top right, replacing plain text)
- Add danger left border: `border-left: 3px solid var(--danger)` when risk > 70
- Add spotlight hover effect: radial gradient follows mouse position
  - Track mousemove on card, set CSS custom property `--mouse-x`, `--mouse-y`
  - `background: radial-gradient(circle at var(--mouse-x) var(--mouse-y), rgba(255,255,255,0.06), transparent 40%)`
- Stats row at bottom: PID, Files count, Net connections (mono font)
- Transition: translateY(-2px) + shadow increase on hover

**Claude Code Prompt for F2:**
```
Продолжаем feat/fancy-ui. Phase F2 — Agent Cards.

F2.1: Создай src/renderer/components/Sparkline.svelte:
- Svelte 5 runes. Props: data (number[]), color (string, default 'var(--accent)'), width (number, default 100), height (number, default 30)
- SVG polyline. Нормализуй data в диапазон 0-height. Points = data.map((v, i) => `${i * (width/data.length)},${height - normalized}`)
- Опционально: линейный gradient fill ниже линии (opacity 0.1)
- CSS анимация на mount: stroke-dasharray + stroke-dashoffset → 0 за 600ms
- НЕ используй canvas. Чистый SVG.

F2.2: Создай src/renderer/components/TrustBadge.svelte:
- Props: grade (string), size ('sm'|'md', default 'sm')
- Маппинг: A+/A → --accent, B → --info, C → --warning, D/F → --danger
- Pill shape (border-radius: 20px), padding 4px 8px
- Background: rgba версия цвета (opacity 0.1), text = полный цвет
- Font: var(--font-mono), weight 700, size 11px (sm) / 13px (md)

F2.3: Обнови AgentCard.svelte:
- Импортируй Sparkline и TrustBadge
- Header: имя слева, TrustBadge справа (вместо старого текста score)
- Под header: Sparkline (данные из agent.riskHistory или последние 60 точек)
- Если agent.riskScore > 70: добавь border-left: 3px solid var(--danger)
- Spotlight hover: on:mousemove → вычисли позицию мыши относительно карточки → CSS переменные --mouse-x, --mouse-y → background: radial-gradient(circle at var(--mouse-x) var(--mouse-y), rgba(255,255,255,0.06), transparent 40%)
- Stats row: PID, Files, Net — font-mono, text-2, разделители " • "
- Hover: translateY(-2px), box-shadow усиление, transition 300ms cubic-bezier(0.4,0,0.2,1)

ПРАВИЛА:
- Sparkline и TrustBadge — независимые компоненты, будут использованы в других местах
- riskHistory может не существовать — fallback на пустой массив
- Все hover/transitions на transform/opacity ТОЛЬКО
- npm test && npm run build после каждого шага
- Коммиты: feat: add Sparkline component, feat: add TrustBadge component, feat: redesign AgentCard with sparklines and trust badges
```

---

### Phase F3 — Feed & Footer Polish — ~2h
> Same branch: `feat/fancy-ui`

**F3.1 — Feed Item Animations** (45min)
- File: `GroupedFeedItem.svelte`
- New events: fade-in + slide-down (transform: translateY(-8px) → 0, opacity 0 → 1)
- Severity color strip: left border colored by severity (critical=danger, high=warning, medium=info)
- Severity badge: small pill badge before the event text
- Alternate row background: every other row slightly lighter

**F3.2 — Footer Mini Charts** (45min)
- File: `Footer.svelte`
- Replace bare "CPU 0%" with: label + Sparkline (40px wide, 16px tall) + value
- Same for MEM
- Keep: version, uptime
- Add: subtle scan pulse dot (green dot that pulses when scan is active)
- Data: CPU/MEM history from stats-update IPC (last 60 readings, 1/sec)

**F3.3 — Tab Transition** (30min)
- File: `App.svelte` or wherever tab switching lives
- On tab change: 200ms transition
  - Current tab: opacity 1→0, translateY(0→-4px)
  - New tab: opacity 0→1, translateY(4px→0)
  - Optional: single horizontal scanline flash (a 2px green line sweeps top-to-bottom in 150ms)
- CSS-only, no JS animation library

**Claude Code Prompt for F3:**
```
Продолжаем feat/fancy-ui. Phase F3 — Feed & Footer.

F3.1: Обнови GroupedFeedItem.svelte:
- Новые события появляются с анимацией: translateY(-8px)→0 + opacity 0→1 за 300ms
- Используй Svelte transition:fly или CSS animation class
- Severity color: border-left 3px — critical=var(--danger), high=var(--warning), medium=var(--info), low=transparent
- Чередование фона: :nth-child(even) rgba(255,255,255,0.02)

F3.2: Обнови Footer.svelte:
- Замени "CPU 0%" на: label "CPU" + Sparkline(width=40, height=16, data=cpuHistory) + значение
- То же для MEM
- cpuHistory/memHistory — массивы последних 60 значений из stats-update IPC
- Если данных нет — показывай пустой sparkline
- Добавь пульсирующую зелёную точку (6px, animation: pulse 2s infinite) когда scan активен
- Стиль точки: box-shadow: 0 0 8px var(--accent)

F3.3: Добавь tab transition:
- При смене таба: уходящий контент opacity 1→0 + translateY(0→-4px) за 150ms
- Входящий контент: opacity 0→1 + translateY(4px→0) за 150ms (с задержкой 50ms)
- CSS only: используй Svelte transition или CSS класс .tab-enter / .tab-exit
- НЕ используй {#key} если это ломает текущий show/hide паттерн (tab switch <1ms)

ПРАВИЛА:
- Переиспользуй Sparkline.svelte из F2
- Footer sparklines берут данные из существующего stats-update IPC
- Tab transition НЕ должна заменить show/hide оптимизацию — это overlay эффект поверх
- npm test && npm run build
- Коммиты: feat: add feed entry animations, feat: add footer sparkline charts, feat: add tab switch transition
```

---

### Phase F4 — The Wow (Risk Ring + Final Polish) — ~3h
> Same branch: `feat/fancy-ui`

**F4.1 — Risk Ring** (2h)
- New file: `RiskRing.svelte`
- SVG circle with `stroke-dasharray` animated to show system health 0-100
- Glow effect: drop-shadow filter on the ring
- Pulse animation: ring scales 1.0→1.02→1.0 every 3s when score > 80
- Center number: large mono font showing the score
- Color: interpolate accent→warning→danger based on score
- Replace or overlay on current Radar component
- This is the HERO element — the screenshot king

**F4.2 — Typography & Glass Final Pass** (30min)
- Apply Outfit to all `.panel-title`, brand name, tab labels
- Apply DM Sans to body text, button labels
- Apply DM Mono to all data: PIDs, timestamps, scores, file paths
- Verify glass tokens applied consistently across all panels
- Check: inset 1px white highlight on every panel top edge

**F4.3 — Background & Atmosphere** (30min)
- Subtle radial gradients on body (green glow at 15% 50%, red glow at 85% 30% — from mockup)
- Opacity very low (0.03) — just enough to add depth
- Verify: no performance impact (CSS only, composited)

**Claude Code Prompt for F4:**
```
Продолжаем feat/fancy-ui. Phase F4 — Risk Ring + Polish.

F4.1: Создай src/renderer/components/RiskRing.svelte:
- SVG кольцо (stroke-dasharray). Props: score (number 0-100), size (number, default 280)
- Рассчитай circumference = 2 * PI * radius. dashoffset = circumference * (1 - score/100)
- Цвет: score < 40 → var(--accent), 40-70 → var(--warning), >70 → var(--danger)
- Glow: filter: drop-shadow(0 0 20px {color} / 0.4)
- Пульс: когда score > 80, кольцо пульсирует (scale 1→1.02→1, 3s, infinite)
- Центр: число score, font-mono, 32px, bold, цвет кольца
- Подпись под числом: "SYSTEM HEALTH" text-2, 11px, uppercase
- Фон кольца: circle stroke rgba(255,255,255,0.05) — "track"
- Анимация mount: dashoffset от circumference до расчётного за 1.5s ease-out

F4.2: Типографика — пройдись по ВСЕМ компонентам:
- .panel-title, .brand, tab labels → font-family: var(--font-title)
- Все body text, labels → font-family: var(--font-body)
- Все data (PID, timestamp, score, path) → font-family: var(--font-mono)
- НЕ трогай JetBrains Mono если он используется для terminal/code контекстов

F4.3: Атмосфера в body:
- background-image: radial-gradient(circle at 15% 50%, rgba(0,255,136,0.03), transparent 25%), radial-gradient(circle at 85% 30%, rgba(255,51,102,0.03), transparent 25%)
- Это CSS only, zero perf impact

ФИНАЛ:
- npm test (все 489+ тестов зелёные)
- npm run build (0 errors)
- npx tsc --noEmit (0 errors)
- npx eslint src/ --quiet (0 errors)
- Коммиты: feat: add RiskRing component, style: apply typography system, style: add atmospheric background
- Финальный коммит: feat: Fancy Aegis UI redesign — complete
- НЕ мержи в master пока я не подтвержу
```

---

## POST-IMPLEMENTATION

### GIF Recording Plan
After all 4 phases, record a 15-20 second GIF showing:
1. App boot (fast, 439ms)
2. Shield tab — Bento grid, radar sweep, Risk Ring glowing
3. Agent cards — sparklines animating, hover spotlight
4. Danger agent — red border, C- badge, escalating sparkline
5. Tab switch — glitch transition to Activity
6. Feed — new events sliding in with severity colors
7. Back to Shield — full dashboard beauty shot

### Reddit Post Plan
- Subreddits: r/programming, r/cybersecurity, r/SideProject, r/opensource
- Title: "I built an open-source EDR that monitors what AI agents do on your machine [Electron + Svelte]"
- Format: GIF + description with GitHub link
- Key selling points: zero UI libraries, 489 tests, 106 agent signatures, MIT license

### Files to Update After Implementation
1. **AEGIS-PROJECT-CONTEXT → v11** — add Fancy UI phase, new components, updated component count
2. **CLAUDE.md** — update component count, add new files
3. **SKILL.md (aegis-context)** — reflect new design system
4. **.agent/skills/ mirror** — sync
5. **README.md** — new GIF, updated screenshots
6. **Memory** — update with fancy UI completion

---

## VERSION PLAN

```
v0.4.0-alpha (current master) — TypeScript foundation + refactoring
v0.5.0-alpha (after fancy merge) — Fancy UI redesign
v0.6.0-alpha (later) — P5-B.1 spawn hardening + security
```

---

## REFERENCE: Mockup HTML

The Gemini mockup (document 7) serves as the visual target for Shield tab layout.
Key decisions from mockup:
- 3-column grid: 350px | 1fr | 380px
- Radar left, summary top-center, feed bottom-center, agents right
- Agent cards: name + badge header, sparkline middle, stats bottom
- Footer: version left, CPU/MEM mini charts right, uptime far right
- Color palette: #050507 bg, #00ff88 accent, #ff3366 danger
- Fonts: Outfit titles, DM Sans body, DM Mono data

## REFERENCE: Audit Document

The Gemini audit (document 8) provides competitive analysis:
- CrowdStrike: modular dashboards, MITRE badges → adapt colored badges
- Elastic: bento grid, KQL search → adapt bento layout + summary charts  
- SentinelOne: actionable insights, real-time animations → adapt micro-interactions
