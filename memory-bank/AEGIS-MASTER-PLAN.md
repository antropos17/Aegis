# AEGIS — Master Development Plan

> **Назначение:** единый источник правды по разработке AEGIS. Положи в `memory-bank/AEGIS-MASTER-PLAN.md` ИЛИ вставь содержимое в новый чат — контекст подхватится отсюда.
> **Scope:** только разработка (код / архитектура / фичи). Без Dev.to-поста, без лендинга, без маркетинга.
> **Сверено по живому коду:** master @ `<verify: git rev-parse --short HEAD>`, 2026-06-03. Числа — снимок, не истина.

---

## 0. Как пользоваться + рабочий протокол

**TRUST CODE OVER DOCS.** Перед любым числом/фактом — читай источник (`package.json`, `git log`, `src/shared/*`, `ARCHITECTURE.md`). Числа в этом файле устаревают.

**Цикл Claude Code (на каждый шаг):**
```
/clear → read CLAUDE.md, @package.json, memory-bank/progress.md
→ ОДНА задача → (нетривиальное: /plan, жди OK)
→ verify gate → commit "type: summary" → update progress.md → STOP
```
- Verify gate: renderer-only → `npm run build:renderer`; логика/типы → `npm run typecheck && npm run lint && npm test`.
- Степы батчами по 3–5 с тайм-оценками. `/simplify` после каждых 3–5 шагов.
- Мульти-файловое — через orchestration / параллельные субагенты; read-only анализ — субагент (`test-auditor`), чтобы не сорить контекст.
- Deterministic ship/merge — скилл `/ship` (format→commit→push→PR→CI). CC делает `git push` сам; force-push master запрещён.

---

## 1. Что такое AEGIS + проверенное состояние

**Одной строкой:** local-first, out-of-band OS-level наблюдатель за AI-агентами (процессы / файлы / сеть) с сигнатурами агентов, risk-scoring и дашбордом. Сидит **снаружи** агента → не требует кооперации и **не тормозит** агента (в отличие от hook-based).

**Снимок (ориентир — не истина; сверяй командой, не вбивай число):**
```sh
# version
node -e "console.log(require('./package.json').version)"
# агенты
node -e "console.log(require('./src/shared/agent-database.json').agents.length)"
# правила
grep -rhcE '^\s*-\s*id:' rules/*.yaml | paste -sd+ | bc
# тесты (считаются запуском, число не вбивать)
npm test 2>&1 | tail -3
# LOC main
find src/main -name '*.js' | xargs wc -l | tail -1
# commit / дата
git rev-parse --short HEAD ; date +%F
```
- Electron 33 · Svelte 5 (runes) · Vite 7 · main = JavaScript/CommonJS · renderer/shared = TS · chokidar 3 · ajv · js-yaml · Vitest 4

---

## 2. Архитектурная правда (что код реально делает)

**Слой сбора:** Windows — `tasklist /FO CSV` (async) + PowerShell `Get-CimInstance Win32_Process` (parent-map) + `Get-NetTCPConnection` (сеть) + `handle64.exe`/Get-Process (file handles); файлы — chokidar (`usePolling:false`). Кэши: parent-chains 60s TTL, CWD 60s TTL, DNS 300s TTL. **Всё на Electron main process — ни `utilityProcess`, ни `worker_threads`.**

**Поток:** scan → file/network → baselines → anomaly (0–100) → risk score → trust grade (A+…F) → audit (JSONL) → UI.

**Что ВИДИТ:** спавны процессов (на опрос), запись/создание/удаление файлов, открытые handle на момент опроса, исходящие TCP + DNS (на опрос / по change), known-vs-unknown классификацию endpoint'ов.

**Что НЕ видит (security-дыры — всё это dev-задачи):**
- **Чтение файлов.** chokidar ловит `add/change/unlink`, не `IN_ACCESS`. Агент **читает** `~/.ssh/id_rsa` → file-watcher молчит; ловится только если handle открыт в момент 30s-скана или по последующему соединению. → твоя сильнейшая детекция фактически **сеть**, не файлы.
- **Polling gap.** Процесс/соединение, живущее между опросами (≤10s процессы, ≤15s сеть), невидимо.
- **Intent.** Нет перехвата LLM-трафика → видишь следствия, не намерение.
- **Tamper.** User-space JS-процесс + неподписанный редактируемый JSONL-лог; self-protection нет.

**Почему это важно (research):** чисто поведенческий детект агент обходит (Weak-to-Strong Monitoring, Scale/CMU/MIT); неподделываемы именно OS-level эффекты (соединение к unknown-endpoint). → **network scoring — несущая способность**, и спрос тестировщиков это подтверждает.

---

## 3. Проверенный bug backlog

### P0 — корректность (чинить первым, КАЖДЫЙ с regression-тестом)
| ID | Где (anchor) | Баг | Эффект |
|---|---|---|---|
| C-01 | `file-watcher.js` `aiAgents.length>0?aiAgents[0]` | file-события → первому AI-агенту; self-access exemption тоже против неправильного агента | ломает атрибуцию / audit / baselines / калибровку risk. **PREREQ** для per-agent и корреляции |
| C-02 | `scan-loop.js` `setInterval(doProcessScan)` | нет reentrancy-guard (у `doNetworkScan` есть) | overlap сканов → дубли/пропуски сессий |
| C-03 | `audit-logger.js` + `logger.js` `_buffer.splice(0)` до append | в `catch` буфер не восстанавливается | тихая потеря audit/log |
| C-04 | `agent-database.json` + `process-scanner.js` (first-match `break`) | 4 межагентных дубля имён (`claude.exe`, `gemini`, `copilot-language-server`, `sm-agent`) + 6 повторов имени внутри агента | mis-identification агентов |
| C-05 | `rules/secrets.yaml` SC003/004/007 | `password`/`credential`/`api_key` без path-anchor | масс. false positives |

**Test-quality (важно):** у всех 5 модулей ЕСТЬ тесты, но баги проходят зелёными (C-01 — фикстуры с одним агентом; C-02 — нет concurrency-теста; C-03 — проверяет только callback, не сохранность). Каждый фикс нужен с тестом, который **провалился бы при наличии бага**.

### P1 — функциональные дыры / UI-vs-реальность
- **C-06** localModels шлются после `scan-batch` → опаздывают на цикл.
- **C-07** пользовательские `ignoredDirectories` не доходят до project-watcher.
- **C-08** частичный `save-settings` сбрасывает недостающие поля к дефолтам.
- **C-09** customAgents хранятся/показываются/экспортируются, но **в runtime не сканируются**.
- **C-10** UI-пресеты «block»/Paranoid **не enforce'ятся** в main. → решить: реализовать минимальный enforcement ИЛИ переименовать в «alert only (enforcement planned)».
- **C-12** anomaly-тост-шторм на первом рендере (пустой prevAnomalyKeys).
- **C-13** async setState после unmount в нескольких компонентах.
- *(C-11 reveal-in-explorer path traversal — **УЖЕ ИСПРАВЛЕН** (`isInsideUserData`-guard). Не переоткрывать.)*

### P2 — производительность (→ Phase 2)
- **C-14** `O(процессы×агенты×паттерны)` матчинг на скан.
- **C-15** синхронный обход `/proc` (linux) блокирует event loop; darwin `O(n²)`.
- **C-16** `classifySensitive` — линейный проход; `categoryIndex` есть в `rule-loader.js`, но не используется.
- **C-17** файлы >300 строк: `ipc-handlers.js` 556, `ActivityFeed.svelte` 492, `main.js` 424, `constants.js` 415, `ai-analysis.js` 391, `config-manager.js` 387, `file-watcher.js` 376, …
- **C-18** все вкладки смонтированы; `ActivityFeed` ~200 строк без виртуализации.

### P3 — абсурд / грязь
- **C-19** `AgentStatsPanel.svelte` `$derived($tick ? Date.now() : Date.now())` — обе ветки идентичны.
- **C-20** `ActivityFeed.svelte` мёртвая ветка в `formatRelativeTime`.
- **C-21** разные пороги trust-grade в `trust-badge-utils` vs `risk-scoring`.
- **C-22** двойной источник правды: `constants.js` SENSITIVE_RULES (deprecated) vs `rules/*.yaml`.

---

## 4. Performance roadmap (чтобы летало)

**Tier 0 — быстрые победы, без смены архитектуры:**
1. **Движок с main-потока в `utilityProcess`** — главный UX-выигрыш, убирает фризы (в твоём roadmap). Engine стримит события в Electron по пайпу.
2. **Индекс `имя→агент` (O(1))** — фикc C-14, детерминирует дубли C-04.
3. **`classifySensitive` через `categoryIndex`** (C-16).
4. **Схлопнуть PS-вызовы в один скрипт за цикл + персистентный runspace** — режет spawn-tax (бьёт на churn агентов).
5. **Linux /proc — асинхронно** (C-15); darwin — убрать O(n²).
6. **Ring buffers / OOM hardening** (твой roadmap).

**Tier 1 — event-driven (настоящий «полёт») → Phase 5.**
> ⚠️ Не путать: смена слоя сбора (ETW/драйвер) = «летает»; Tauri-vs-Electron = вес RAM UI. Сначала первое.

---

## 5. Security hardening roadmap (dev)
- **Tamper-evident audit:** hash-chained JSONL (`prevHash` + `hash = H(prevHash + canonical(event))`) + опц. Ed25519-подпись. Строится на фиксе C-03. (паттерн Nobulex / MS AGT)
- **Закрыть read-слепоту:** сейчас — повысить покрытие handle-скана; полноценно — ETW file-events / fanotify (Phase 5).
- **Закрыть polling gap:** event-driven сбор (Phase 5).
- **Self-protection:** движок в отдельном (elevated/service) процессе; защита каталога audit.
- **Intent / boundary tracing (честно):** на Windows ≈ opt-in локальный proxy или WFP, **НЕ eBPF**; делать под спрос. Референс — AgentSight.
- **Network scoring — несущее:** блокировать нельзя (Claude Code нужен интернет) → усиливать known-vs-unknown классификацию endpoint'ов + скоринг. Это сигнал, на который реагируют пользователи.

---

## 6. Capability / feature roadmap (заимствования + спрос)
- **OWASP Agentic AI Top 10 (2026) mapping** — тегировать каждое правило/детект (goal hijacking, tool misuse, identity abuse, rogue agents…). Заменяет MITRE-overclaim; стандарт, на который якорятся MS AGT и экосистема.
- **OpenTelemetry `gen_ai.*` / event export** — интероп с Phoenix/Langfuse/Grafana.
- **Headless / daemon JSON-режим** — работа без Electron, структурированные JSON-логи + trust-score, для VM/CI/серверов. *(Валидировано спросом — Apex Stack; ложится на `src/main/cli.js`.)*
- **SQLite session store + query CLI** (`db`/`report`/`prompts`/`list`) — модель AgentSight; дополняет/заменяет JSONL.
- **`top`-style ranked live view** — как AgentSight `top`: ранг по tool-calls / file / network activity / health.
- **Dashboard UX (из productivity-дашбордов):** Kanban (Working/Waiting/Completed/Error), activity heatmap, live/offline индикатор. *(parent-child agent tree с chevron у тебя уже есть.)*
- **analyzer-chain рефактор** (паттерн AgentSight) — композируемые stream-процессоры; туда же ложатся self-access exemption + event dedup (инварианты risk-engine) + privacy-фильтры (strip auth-headers).

---

## 7. Intelligence (gated on C-01)
- **Per-agent baselines + z-score anomaly** — твой ML-roadmap; валидировано (John Sun, Mykola).
- **Process→file→network correlation** (идея AgentSight) — **ТРЕБУЕТ** корректной атрибуции (сначала C-01).
- **Human-in-the-loop triage** — эскалировать только заранее зафлагованные аномалии (weak-to-strong: +~15% TPR при FPR 0.01).
- **Rules UI** (твой roadmap; IPC готов — `getRulesByCategory`/`onRulesReloaded`, фронт не построен).

---

## 8. Порядок выполнения по фазам + зависимости
```
Phase 1   Корректность:  C-01 → C-04 → C-03 → C-02 → C-05   (+ regression-тесты)
Phase 2a  Перф/UX:       utilityProcess — вынос движка с main-потока
Phase 2b  Перф (Tier 0): O(1)-index, categoryIndex, PS-runspace, async /proc, ring buffers
Phase 3   Доверие:       hash-chained signed audit, OWASP mapping, OTel export
Phase 4a  Охват:         headless JSON daemon
Phase 4b  Охват:         SQLite session store + query CLI
Phase 4c  UX:            top-view (ranked live) + dashboard UX
Phase 5   Ров (moat):    Rust/native event-driven sidecar (ETW Win / eBPF+fanotify Linux / EndpointSecurity mac)
          (multi-month, native sidecar — НЕ недельная задача)
                         → закрывает polling gap + read-слепоту + tamper + нагрузку на main
Phase 6   Интеллект:     per-agent baselines, z-score, correlation, triage, Rules UI
```
**Жёсткие зависимости:**
- **C-01 → Phase 6** (корреляция / per-agent невозможны при сломанной атрибуции).
- **C-03 → Phase 3** (hash-chain строится на исправленном flush).
- **Phase 2a `utilityProcess` → Phase 5** (вынос движка — ступенька к sidecar).
- **analyzer-chain** — дом для self-access exemption + dedup (зона калибровки C-04/C-05).

---

## 9. Инварианты (НЕ ломать)
- main = Node/CommonJS APIs only; renderer = browser APIs + Svelte 5 **runes** (`$state`/`$derived`/`$effect`), **никакого legacy Svelte 4**.
- TS — только renderer/shared; main = JS + JSDoc.
- Новые IPC-каналы → через `preload.js` contextBridge, имена **kebab-case**.
- Файл ≤300 строк (soft), early returns, named exports.
- Commit после каждого рабочего состояния; **verify ПЕРЕД commit**; **НИКОГДА не force-push master**.
- Один P0 = один PR ≤300 строк. Не пихать несколько фиксов в один PR (защита от git-гонок и нечитаемых diff).
- Risk-engine: **self-access exemptions, event dedup, веса с diminishing returns** — не ломать при правках scoring.
- **Code-honesty:** ни «tamper-proof» / «kernel» / «blocks» в строках/UI кода, пока способность не реализована (см. C-10).
- TRUST CODE OVER DOCS — числа сверять с кодом.

---

## 10. Definition of «серьёзный проект» (exit criteria)
- [ ] Phase 1 DoD: C-01..C-05 закрыты; у каждого regression-тест, который КРАСНЫЙ без фикса (доказывает реальность фикса).
- [ ] 0 P0-багов; у каждого — тест, который падает без фикса.
- [ ] Мониторинг вне main-потока; нет UI-jank.
- [ ] Tamper-evident (hash-chained) audit; правила с OWASP-маппингом; OTel-экспорт.
- [ ] Headless daemon-режим работает (пригоден для VM/CI).
- [ ] Event-driven сбор хотя бы на Windows (ETW) → polling gap + read-слепота закрыты.
- [ ] Per-agent baselines + anomaly.

---

*Конец плана. Источник истины — код; этот файл синхронизировать после крупных изменений.*
