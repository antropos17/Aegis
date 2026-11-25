# Tracker «Sualver.az + Туалет»

Shared progress page for Руслан and Сеймур: https://antropos17.github.io/sualver-toilet-tracker/

The page is a static file on GitHub Pages (this repository, branch `main`). Data lives in Firestore (Firebase project `pyos-tracker`): anyone can read, only Руслан and Сеймур signed in with Google can write from the page. Claude writes with `kit/tracker.mjs` and a service account key, not with the Artifact tool.

## Setup on a machine (once)

1. Clone this repository anywhere; below `<kit>` is the absolute path to its `kit` folder.
2. `cd <kit> && npm install` (installs `firebase-admin`, Node 18+).
3. Put the service account key at `<kit>/firebase-key.json` or set `TRACKER_FIREBASE_KEY=<path>`. The key is a secret: Руслан hands it over privately; it is in `.gitignore`, never commit it, never print it.
4. `gh auth login` (for screenshots, see below).
5. Check: `node "<kit>/tracker.mjs" goals toilet` prints the open goals.

Commands (each prints what it writes; add `--dry` to write nothing):

| What | Command |
|---|---|
| Open goals of a project | `node "<kit>/tracker.mjs" goals <project>` (`--all` with closed) |
| A document, e.g. sections | `node "<kit>/tracker.mjs" get projects <project>` |
| Take a goal | `node "<kit>/tracker.mjs" take <goalId> --person <p>` |
| Free a goal | `node "<kit>/tracker.mjs" release <goalId>` |
| New goal | `node "<kit>/tracker.mjs" add-goal <project> "<title>" --person <p> [--group <id>] [--take]` |
| New project (only if missing) | `node "<kit>/tracker.mjs" add-project <key> "<name>" --person <p> --groups "g1:…,g2:…" [--repo o/r] [--color c] [--show id]` |
| Close a goal | `node "<kit>/tracker.mjs" close <goalId> --person <p>` |
| Post a stage (and close its goals) | `node "<kit>/tracker.mjs" stage <file.json>` |
| Add a screenshot | `node "<kit>/tracker.mjs" upload-shot <file.png>` → prints the file name |

Every finished step of work in this repository is posted there as a stage: what changed (diff-style lines), before and after screenshots, the GitHub commits, models, tokens, API-equivalent cost and time. The people only look at the page; Claude does all the posting. The page draws a timeline with a slider, a graph of changes per person, and a breakdown per section and per person by change type.

## When to post

- After `git push` from Claude Code. The `PostToolUse` hook in `.claude/settings.json` runs `report.mjs hook`: it only saves a draft with the numbers to `.claude/tracker-draft.local.json` and reminds Claude to post. The hook writes nothing to the tracker; Claude posts the stage itself with `tracker.mjs` (section «How to post»), without asking.
- If the turn was interrupted after the push and nothing was posted, run `node tools/tracker/report.mjs draft` and post from that draft.
- After a finished, verified stage without a push, or when the user asks ("отчитайся в трекер"): run `node tools/tracker/report.mjs draft` yourself.
- Not for small edits, failed attempts or work that was not checked.

## Screenshots: before and after

A change that is visible on screen must have a **before** and an **after** screenshot of the same screen, same size, same state. This is the main thing the other person looks at.

`shot` needs Playwright in the repository; it is optional and used only for screenshots. Check with `npm ls playwright`; if it is missing, install it (`npm i -D playwright && npx playwright install chromium`) or take the screenshot another way.

1. **Before you start** a change that will be visible, open the screen it affects and take the before shot: `node tools/tracker/report.mjs shot <url> .claude/shots/<slug>-before.png --width 390 --height 844` (add `--dark` or `--full` when that is what changes). `.claude/tracker.json` has a `preview` entry with the local address and how to start it. For a state deep inside the app, write a short Playwright script that gets there and reuse it for the after shot.
2. **After** the change is verified, take the after shot with the same command, size and state: `.claude/shots/<slug>-after.png`.
3. If the before shot was not taken at the start, make it from the base commit in the draft (`base`): extract that version with `git archive <base> <paths> | tar -x -C <temp dir>` (not a checkout of the working tree), start it the same way, shoot the same screen, then remove the temp dir. Never present a current screenshot as "before".
4. One to three pairs per stage, the screens where the difference is clearest. Phone size 390×844 by default, 375×667 for short-screen work, desktop 1280×800 when the change is desktop-only.
5. All pairs of one stage use the same screen size, so they sit in equal frames on the page.
6. Mark what changed. Look at both shots and add `marks` to the **after** entry of each pair: one to three ellipses over the zones that differ, `[{x, y, w, h}]` in percent of the image (`x`, `y` = centre, `w`, `h` = size). Example: a button at the right edge, two thirds down: `{ "x": 84, "y": 68, "w": 30, "h": 6 }`. Mark only real differences, a little larger than the element.
7. A stage with nothing visible (tests, server, git, docs) gets no screenshots and `visual: false`.

Upload each file with `node "<kit>/tracker.mjs" upload-shot <file>`. It commits the file to `shots/` of this repository through the GitHub API (`gh api`, no clone needed) and prints its name, for example `3a1084c98f69e489bb0ae192957a87f0.png`. The name comes from the file content, so the same file never lands twice. Use that name as `id` in `shots`. It needs write access to the repository; GitHub Pages shows the file about a minute after the upload. `.claude/shots/` of the project is not committed.

## Who is posting

`.claude/tracker.local.json` (not committed) holds `{"person": "ruslan"}` or `{"person": "seymur"}`. If it is missing, ask the user once which of the two they are and create it.

On a machine that posts to Telegram it also holds the path to the bot: `{"person": "ruslan", "telegram": "X:/Туалет/telegram/bot/post.mjs"}`. The bot folder and its token are not in any repository; only Руслан decides who gets them.

## At the start of a task: take a goal

The «Цели» tab shows who does each open goal («делает Руслан»), so the two of you do not work on the same thing. Mark the goal before you start.

1. Find it: `node "<kit>/tracker.mjs" goals <project>`. Each line: id, section, who does it, title.
   - If it says `делает <the other person>`, do not take it. Tell the user in one line and ask what to do. (`take` refuses such a goal too.)
   - If no goal matches, create and take it at once: `node "<kit>/tracker.mjs" add-goal <project> "<short title>" --person <person> --group <section id> --take`.
2. Take it: `node "<kit>/tracker.mjs" take <goalId> --person <person>` (writes `takenBy`, `takenAt` and a `goal_taken` event).
3. If the task is dropped without closing the goal, free it: `node "<kit>/tracker.mjs" release <goalId>`.

Closing the goal at the end (step 3 below) frees it too. A goal without `takenBy` is free.

## How to post

1. Read the draft (`.claude/tracker-draft.local.json`): `project`, `person`, `repo`, `branch`, `base`, `commits` (full SHA, subject, GitHub `url`) and `usage` (`startedAt`, `finishedAt`, `wallMin`, `activeMin`, `tokens`, `cost`, `models[]`). Do not edit the numbers. You may rewrite each `models[].purpose` into plain Russian that says what that model did, for example «реализация и тесты» or «субагент: поиск по коду».
2. Pick the section (`group`): `node "<kit>/tracker.mjs" get projects <project>` and use one of its `groups[].id`. One stage, one section; if the work spans two, post two stages.
3. Save the stage to `.claude/shots/u-<project>-<short-slug>.json` and write it with `node "<kit>/tracker.mjs" stage <that file>`. The file name (or an `"id"` field) is the document id. Fields:
     - `project`, `person`, `via: "claude"`, `group`
     - `title`: what changed for a person using the product, up to 90 characters, Russian
     - `items`: 3 to 6 short Russian lines, each starting with `+ ` new, `~ ` changed, `! ` fixed or `- ` removed. These prefixes are counted into the graphs, so choose them carefully: a bug that is gone is `! `, a new control is `+ `, a layout that moved is `~ `.
     - `shots`: `[{id, type, role: "before"|"after", pair: 0, caption, marks}]`, `id` = the name printed by `upload-shot` (`marks` only on the after entry), one `pair` number per before/after pair, the same `caption` on both (which screen, which size)
     - `visual`: `true` when something on screen changed, `false` otherwise
     - `goalIds` (goals this stage closed, `[]` if none), `commits`, `branch` and `usage` from the draft, `createdAt` (now, ms)
   `stage` writes the stage and closes every goal in `goalIds` (`done`, `doneAt`, `doneBy`, frees `takenBy`, adds a `goal_done` event) in one batch. `createdAt` defaults to now.
   - For a new task that came up: `node "<kit>/tracker.mjs" add-goal <project> "<title>" --person <person> --group <id>`.
   To find goal ids: `node "<kit>/tracker.mjs" goals <project>`.
4. Run `node tools/tracker/report.mjs mark` so the next report starts after this one.
5. Post the stage to the Telegram channel @pyOS_V2, without asking. Only on a machine where `.claude/tracker.local.json` has `"telegram"` (the path to the bot's `post.mjs`); if the field is missing, skip this step.
   - Run `node "<telegram>" --id <doc_id>`. The bot reads the stage, its section and closed goals from Firestore and takes the screenshots from `shots/` of its local tracker clone (pull it first if the shots were uploaded from another machine). The old form `node "<telegram>" .claude/shots/<doc_id>.json <files>` still works.
   - The script posts silently and prints the post. A second run with the same file sends nothing; with changed text it edits the post. If it prints an error, tell the user in one line; the stage stays in the tracker either way.
6. Tell the user in one line what was posted, which screenshots went with it, and whether it went to Telegram.

Only facts verified in this session go into the stage. No file paths in the text, no em dashes; commits carry the hashes and links.

## Cost

`cost` is what the same tokens would cost on the Claude API (input, output, cache writes and cache reads, at the prices in `report.mjs`). On a Claude subscription nothing is billed per token; the number is for comparing work, not an invoice.

## Adding another project

Projects are no longer fixed to two. A person adds one in the tracker itself: tab «Цели», button «+ Проект» (name, optional GitHub repository, colour, sections). The project shows up at once for everyone who has the page open: in the stories row, in «Цели», in the side panels and in the «Пост» form.

To let Claude post stages for it from a repository:

1. In the tracker open «Цели», press «Править» and copy the project key shown under the project (`Ключ проекта для Claude`, for example `p-glass-lab`). A key made from a non-Latin name is random, like `p-22dtz5`.
2. Copy `tools/tracker/` (`report.mjs`, this README) into the repository.
3. Create `.claude/tracker.json` (drop `preview` if the project has no screen):
   ```json
   {
     "project": "p-glass-lab",
     "tracker": "https://antropos17.github.io/sualver-toilet-tracker/",
     "preview": { "start": "npm start", "url": "http://127.0.0.1:4173/" }
   }
   ```
4. Add the push hook to `.claude/settings.json` (merge into existing `hooks` if the file has them):
   ```json
   { "hooks": { "PostToolUse": [ { "matcher": "Bash", "hooks": [
     { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/tracker/report.mjs\" hook" } ] } ] } }
   ```
   and the lines `.claude/*.local.json` and `.claude/shots/` to `.gitignore`.
5. Each person creates `.claude/tracker.local.json` with `{"person":"ruslan"}` or `{"person":"seymur"}`.
6. Add this rule to the project's `CLAUDE.md`:
   ```markdown
   ## Progress tracker

   Руслан and Сеймур follow this project on a shared tracker, and Claude posts every finished stage there. The protocol is in `tools/tracker/README.md`.

   - Before starting a change that is visible on screen, take a "before" screenshot of the affected screen: `node tools/tracker/report.mjs shot <url> .claude/shots/<slug>-before.png`. After the change is verified, take the "after" shot of the same screen, size and state.
   - After a `git push` or a finished, verified stage, post the stage with both screenshots, its section and the change lines (`+` new, `~` changed, `!` fixed, `-` removed).
   ```
7. Check: `node tools/tracker/report.mjs draft` prints the project key, the person and token counts.
8. Rule «кто что делает» (once per person, not per project). Read `kit/RULES.md`, fill in the placeholders for this person and show them the ready text. Only after their yes, append it as a section to their global `~/.claude/CLAUDE.md`. If the section «Трекер: кто что делает» is already there, compare it with the ready text, show the difference and replace it after a yes. Without a yes, write nothing. The same text with the person's name is in the tracker: «Профиль» → «Правила для Claude» → «Скопировать».
9. Check the rules version. `kit/RULES.md` has the line `Версия правил: 2 (25.11.2026)`. If the line in the person's `~/.claude/CLAUDE.md` has a lower number or is missing, offer to update the section as in step 8.

### Taking a showcase project («Беру в работу»)

1. A person presses «Беру в работу» on a showcase card. The tracker writes `claims/<card id>__<person>` and, for someone else's project, a feed post (`kind: "claim"`).
2. The project joins the working list at once (stories, «Цели», side panels) as a placeholder «Ждёт оценки Claude». The page itself never writes `projects/<key>`. The key is the card id (`kus`, `voxel-boxing`), or `s-<id in lower case>` when the id is not a valid key.
3. The tracker opens a ready prompt for that project (template: `kit/CLAIM-PROMPT.md`, filled with name, key, shared private repository, person, colour). It can be opened again from the card or the placeholder: «Промт для Claude».
4. Pasted into the person's Claude Code, the prompt clones the shared private repository (no access: stop, never create a new one), assesses it, and after a yes writes `projects/<key>` with `tracker.mjs add-project` (only if missing, with `--show <card id>`), goals (`tracker.mjs add-goal`) and one assessment post (`tracker.mjs stage`). Then it installs this kit as in «Adding another project».

The template is embedded in `tracker.html` (`<script id="claim-prompt">`); after editing `kit/CLAIM-PROMPT.md`, copy it there too.

### Second person (Сеймур)

Claude writes to Firestore with the service account key (see «Setup on a machine»), so it works from any Claude account. On the page Сеймур presses «Войти через Google» with his Google account; the page knows him by that email (the email list lives only in the Firestore rules and a private `members` collection, not in this repository). Screenshots need write access to this repository (`upload-shot`).

Needed on the machine: Node 18+, `npm install` in `kit`, the key file, `gh` signed in (`gh auth login`).

The fastest setup is the ready prompt in `kit/SEYMUR-PROMPT.md` of https://github.com/antropos17/sualver-toilet-tracker: paste it into Claude Code. It checks the tools, asks where the projects live, clones this repository, asks about each project separately (showcase, GitHub, tracker) and installs steps 2 to 9 in the chosen repositories. New repositories, publishing and setup commits happen only after a yes; posting after each push is automatic.

In a stage, `group` must be one of the section ids of that project (`projects/<key>.groups`, ids look like `g1`, `g2`); an unknown id lands in «Другое». A project removed with «Убрать проект» is only hidden (`archived: true`): its posts stay in the feed and keep their colour.
