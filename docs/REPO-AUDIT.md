# Full audit of the AEGIS GitHub repository

> **Status:** This audit was conducted during v0.2.0-alpha. Most issues have been resolved in v0.3.0-alpha. See "Resolution Status" section below.

This report reviews the repository's documentation, settings and community files at the time of the audit, and lists the fixes and additions needed.

## 1. README.md: what is outdated?
- **Agent count:** `README.md` lists 94 agents, but `CHANGELOG.md` (0.2.0-alpha) reports an increase to 95, and `AGENTS.md` claims 98. These counts need to agree.
- **Screenshot paths:** `README.md` still references old images in `screenshots/`, such as the historical path `screenshots/activity-feed.png`; that artifact is absent from the current tree. Update the paths to the new Svelte interface screenshots in `docs/screenshots/`, such as `01-shield-tab.png`. Also check whether the root `screenshot.png` is current.
- **Test count:** The stated count is 130 tests. Update it to reflect the recent changes and Svelte 5 rewrite.
- **Features / OS:** The download section says "Mac and Linux are supported experimentally", but the corresponding Roadmap checkboxes remain unchecked. Align these statements, especially since the changelog mentions a macOS build.

## 2. package.json
- **keywords:** ✅ Present (`["ai", "security", "monitoring", "electron", "oversight", "agents", "privacy"]`)
- **homepage:** ✅ Present (`"https://github.com/antropos17/Aegis"`)
- **bugs URL:** ✅ Present
- **repository URL:** ✅ Present

## 3. GitHub repository settings
- **topics:** ✅ Present (`ai-agents`, `cybersecurity`, `developer-tools`, `electron`, `monitoring`, `open-source`, `privacy`, `ai-security`)
- **description:** ✅ Present ("Independent AI Oversight Layer — monitors what AI agents do on your computer...")
- **website URL:** ❌ **Missing** from the About settings on the repository home page. The API returns an empty link, although `package.json` contains it. Add the URL to the repository's About panel on the right.

## 4. Missing community health files
The basic files are present (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and issue/PR templates), but the following are missing:
- ❌ **`FUNDING.yml`**: Provides support links for open-source projects, such as GitHub Sponsors, Patreon and Ko-fi.
- ❌ **`CODEOWNERS`**: Helps assign pull request reviewers automatically.
- ❌ **`SUPPORT.md`**: Describes support channels to reduce support traffic in Issues.

## 5. GIF/video demo
- ❌ **Missing.** Open-source projects often place an animated GIF or short `.mp4` directly below the `README.md` heading to show how the product works and why it is useful: in this case, the radar and scanning. AEGIS has only static `.png` images.

## 6. Contributors section in README
- ❌ **Missing.** There is only an "Author" section (Built by Antropos7). The README has no Contributors section with avatars. Tools such as `@all-contributors` or `contrib.rocks` can help recognize external developers.

## 7. Badges
- **Existing badges:** License (MIT), Platform (Windows), Electron (33), Agents count, Downloads, CI (GitHub Actions).
- **Missing or suggested additions:**
  - `Version`: the current GitHub release or package.json version.
  - `Code Coverage`: with Vitest and V8 coverage already in use, Codecov or Coveralls are candidates.
  - `Community / Chat`: a Discord or Telegram badge, if either exists.
  - `PRs Welcome`: an invitation to open-source contributors.

## 8. Changelog status
- ✅ **Up to date.** `CHANGELOG.md` covers the latest version, `0.2.0-alpha` (February 24, 2026), including the migration to Svelte 5 / Vite 7 and the new monitoring system.

## 9. Cleaning up old files (screenshots/ vs docs/screenshots/)
- ❌ **Backup and old files:** The root `screenshots/` directory still contains legacy screenshots (`activity-feed.png`, `settings.png`). Current interface screenshots are in `docs/screenshots/`.
- **Suggested fix:** Remove the old `screenshots/` directory and update image paths throughout `README.md` to `docs/screenshots/...`.

## 10. Version in Footer.svelte
- ❌ **Hardcoded.** `src/renderer/lib/components/Footer.svelte` (line 72) contains the static version text `<span class="footer-version">AEGIS v0.2.0-alpha</span>`.
- **Suggested fix:** Resolve the version dynamically at build time, for example through Vite's `import.meta.env` using `vite-plugin-version-mark` or a configured `__APP_VERSION__`, or read it from the Node process through IPC.

---

## Resolution Status (updated v0.3.0-alpha, 2026-03-01)

| # | Issue | Status |
|---|-------|--------|
| 1 | Agent count mismatch | ✅ Resolved — 106 agents across all files |
| 1 | Screenshot paths | ✅ Resolved — `docs/screenshots/` + GIF demo |
| 1 | Test count | ✅ Resolved — 436 tests, 25 files |
| 1 | Mac/Linux in Roadmap | ✅ Resolved — experimental support via PR #37 |
| 4 | FUNDING.yml missing | ✅ Resolved — `.github/FUNDING.yml` created |
| 4 | CODEOWNERS missing | ✅ Resolved — `.github/CODEOWNERS` created |
| 4 | SUPPORT.md missing | ✅ Resolved — `.github/SUPPORT.md` created |
| 5 | GIF/video demo | ✅ Resolved — GIF demo in README |
| 6 | Contributors section | ✅ Resolved — 4 contributors with avatars |
| 7 | Version badge | ✅ Resolved — Release badge v0.3.0-alpha |
| 7 | PRs Welcome badge | ✅ Resolved |
| 9 | Old screenshots/ folder | ✅ Resolved — deleted |
| 10 | Footer version hardcoded | ✅ Resolved — dynamic via IPC |
| 3 | Website URL in GitHub About | ⬜ TODO — add manually |
| 7 | Code Coverage badge | ⬜ TODO — set up Codecov |
