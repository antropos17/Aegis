---
alwaysApply: true
---
# Code Quality Rules
- 300 lines/file is a target for NEW files, not an invariant — 18 existing src files already exceed it (largest: file-watcher.js 654, audit-logger.js 600, ipc-handlers.js 503), tests go up to 734. Don't split an existing file just to hit the number; do extract when adding to one that's already over
- No `any` type. Use proper types from src/shared/types/
- GPG signing on all commits
- Verify after EVERY change: npm test && npm run build && npm run typecheck (NOT `npx tsc --noEmit` — the root tsconfig is a solution file and checks nothing)

## Git Workflow (GitHub Flow — strict)
- master ВСЕГДА стабильный. Прямые коммиты в master ЗАПРЕЩЕНЫ.
- Любая работа → feature branch от master:
  - feat/* — новые фичи
  - fix/* — баг-фиксы
  - chore/* — обслуживание, обновления данных
  - docs/* — документация
- Feature branch → PR → merge --no-ff → delete branch
- Один PR = одна логическая задача
- Squash мелких коммитов перед PR (docs: 6 коммитов → 1)
- Git via PowerShell: powershell.exe -NoProfile -Command "cd 'X:\dev\project\AEGIS'; git ..."
- НИКОГДА не добавлять Co-Authored-By headers
- Conventional commits: feat|fix|refactor|perf|chore|docs|test(scope): message

## Branch workflow:
1. git checkout master && git pull
2. git checkout -b feat/task-name
3. Работа + коммиты
4. git push origin feat/task-name
5. Создать PR на GitHub
6. Merge --no-ff → delete branch
