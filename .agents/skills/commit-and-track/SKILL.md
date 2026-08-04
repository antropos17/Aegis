---
name: commit-and-track
description: AEGIS-specific post-task gate — runs format:check, build:renderer, lint, then stages only the files changed by the task (never `-A`), conventional commit, push to the current feature branch (never master). Use when the user says "commit and push", "ship it", or "track this commit" inside the AEGIS project.
---

# Commit and Track

After completing any task:

1. npm run format:check — fix with npm run format if fails
2. npm run build:renderer — must pass 0 errors
3. npm run lint
4. List the files you changed during the task, then stage them by name:
   `git add <file1> <file2> ...`
   Never use `git add -A` / `git add .` — they sweep in untracked secrets, lock files, or unrelated work.
5. git commit -m "[type]: [description]"
   Types: feat, fix, chore, docs, style, refactor
6. Push to the CURRENT feature branch — never master (it's branch-protected):
   `git push origin HEAD`
   This pushes the checked-out branch by name. NEVER `git push origin master`.
7. Report: files changed, errors fixed, status
