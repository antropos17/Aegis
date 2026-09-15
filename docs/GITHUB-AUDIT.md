# GITHUB AUDIT

> **Status:** This audit was conducted during v0.2.0-alpha. Most items have been resolved in v0.3.0-alpha — see resolution table at the bottom.

## Checklist: repository practices and gaps in Aegis

### 1. README best practices
*   **Practices in other repositories:**
    *   **Table of Contents:** Helps readers navigate a long README, with links to installation, usage and contribution instructions.
    *   **"Back to top" links:** Navigation at the end of each section.
    *   **Clear local setup requirements:** Public instructions for environment setup, linting, tests and troubleshooting.
    *   **Project status badges:** CI, downloads, Node version, code coverage (CodeCov), dependency status, PRs Welcome and All Contributors.
    *   **FAQ and Support sections:** Direct users to help and answers.
*   **Gaps in Aegis:**
    *   No Table of Contents.
    *   No dedicated community badges (PRs Welcome, All Contributors, chat/Discord).
    *   No links back to the top of the document.
    *   The Roadmap is a simple Markdown checklist without links to GitHub Projects or Issues.
    *   Little information about where to ask for help (community/chat).

### 2. Contributors & community
*   **Practices in other repositories:**
    *   **All Contributors table or equivalent:** An avatar gallery of everyone who contributed code, documentation or bug reports.
    *   **`all-contributors` bot or GitHub Actions automation:** Adds contributors through PR comments (`@all-contributors please add @username for doc`) or by collecting push activity.
    *   **Specification:** The official `emoji-key` identifies contribution types: 🐛 for bugs, 📖 for documentation and 💻 for code.
*   **Gaps in Aegis:**
    *   The README has no Contributors/Authors section with avatars. Only one author is credited in text.
    *   Neither the `@all-contributors` bot nor the `contribute-list` GitHub Action is configured to update contributor credits automatically.

### 3. GitHub profile & repo polish
*   **Practices in other repositories:**
    *   **Profile README (`.github/profile/README.md`):** An interactive or visual introduction to the creator or organization, with examples from `abhisheknaiidu/awesome-github-profile-readme`.
    *   **Dynamic widgets (Tools, Stats):** `gprm.itsvg.in` provides activity charts, WakaTime coding time, Top Languages and "Current focus".
    *   **Custom Shields.io badges:** A consistent badge style, such as `for-the-badge` or `flat-square`, with custom icons across the repository.
*   **Gaps in Aegis:**
    *   No Profile README for the `antropos17` user or the project organization, if one exists.
    *   No dynamic repository or author metrics.
    *   The README mixes `flat-square`, `flat` and default GitHub Actions SVG badges without a consistent format.

### 4. Vibe coding repos
*   **Practices in other repositories:**
    *   **A `memory-bank` directory with agent conventions:** `progress.md` for completed steps, `implementation-plan.md` for the current feature plan and `tech-stack.md` for technologies.
    *   **System instructions (CLAUDE.md / AGENTS.md):** Detailed rules that the AI always loads.
    *   **Modularity requirements:** Explicit instructions for the LLM to split work into small files and avoid monoliths.
*   **Gaps in Aegis:**
    *   Although `AGENTS.md` and `CLAUDE.md` exist, our `memory-bank` has not traditionally contained `progress.md`, `tech-stack.md` and `implementation-plan.md`, as recommended by the `vibe-coding` guide V1.2.2. Agent documentation is scattered.
    *   No designated Game Design Document or Product Requirements Document serves as the source of truth; we rely on separate descriptions and AGENTS.md.

### 5. Comparison examples: Electron and PostHog
*   **Practices in other repositories:**
    *   **An elevator pitch directly below H1:** A short tagline. PostHog uses "PostHog is an all-in-one developer platform...", followed by a clear TOC. Electron uses "Build cross-platform desktop apps...".
    *   **Translations:** Links to README translations, particularly in open-source projects such as Electron.
    *   **Sponsorship or recruitment links (We're hiring / Open-source vs. paid / Sponsor):** Ways to fund the project or recruit contributors.
    *   **Detailed API documentation:** Links to GitBook, Docusaurus or a dedicated documentation subdomain.
*   **Gaps in Aegis:**
    *   The "Independent AI Oversight Layer" tagline is followed immediately by large screenshots that push the text down. Comparison repositories often use more compact imagery or a short GIF or video showing the product in action.
    *   The README's large "How It Works" section could move to a Wiki or a separate Markdown file.
    *   No community links (Discord/Slack/Twitter) like those in the comparison projects.

---

## Resolution Status (updated v0.3.0-alpha, 2026-03-01)

| Item | Was | Status |
|------|-----|--------|
| Table of Contents | Missing | ✅ Added (collapsible details) |
| Back to top links | Missing | ✅ Added to every section |
| PRs Welcome badge | Missing | ✅ Added |
| Contributors with avatars | Missing | ✅ 4 contributors with avatars |
| GIF demo | Missing | ✅ GIF demo added to README |
| Badges unified flat-square | Mixed | ✅ All flat-square |
| Version badge | Missing | ✅ Release v0.3.0-alpha |
| CLAUDE.md / AGENTS.md | Scattered | ✅ Up to date, 106 agents |
| Elevator pitch + GIF | Static screenshots | ✅ Tagline + GIF |
| FUNDING.yml | Missing | ✅ Created |
| CODEOWNERS | Missing | ✅ Created |
| SUPPORT.md | Missing | ✅ Created |
| Profile README | Missing | ⬜ TODO |
| all-contributors bot | Missing | ⬜ TODO |
| Code Coverage badge | Missing | ⬜ TODO |
| Community Discord/Slack | Missing | ⬜ TODO |
