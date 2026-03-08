# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.9.0-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.8.2-alpha...aegis-v0.9.0-alpha) (2026-03-08)


### Features

* add ci-monitor skill for CI watching and repo health ([bc5c860](https://github.com/antropos17/Aegis/commit/bc5c860fcd51a10836def814a5a4ff7a5afa6764))
* add pr-monitor and ci-monitor skills with /loop support ([#91](https://github.com/antropos17/Aegis/issues/91)) ([2766c10](https://github.com/antropos17/Aegis/commit/2766c109ccc167cabe61e265d175187eb9723676))
* add pr-monitor skill for PR triage and /loop monitoring ([77b959d](https://github.com/antropos17/Aegis/commit/77b959d0f3aa2a8b61f01a67fb2dbf1e3ef5cc88))


### Bug Fixes

* **security:** catch block fallbacks + navigation lock ([5f9859a](https://github.com/antropos17/Aegis/commit/5f9859a18f6c776d7b413dcc0a4ada09392f0486))
* **security:** encrypt API key at rest using Electron safeStorage ([db7b15d](https://github.com/antropos17/Aegis/commit/db7b15d86a04b1acf528b6388c2f7781c7e0b34d))
* **security:** encrypt API key at rest using Electron safeStorage ([8dba03c](https://github.com/antropos17/Aegis/commit/8dba03c0ed0f6c044df5c2e10a542b25ef5f7c89))
* **security:** replace swallowed exceptions with console.error fallback ([08acfe1](https://github.com/antropos17/Aegis/commit/08acfe19af0c74d82662b36953f6d628de02a77f))
* **security:** restrict BrowserWindow navigation and new-window ([e96a94f](https://github.com/antropos17/Aegis/commit/e96a94fa31778fc5acc582c499ac96b248292ae9))


### Documentation

* add /loop tasks and new skills to CLAUDE.md ([5c2fb21](https://github.com/antropos17/Aegis/commit/5c2fb2173fad46f3b2ccb44f8db3b487ea1ddfe9))
* add new skills to aegis-context reference ([a4e621e](https://github.com/antropos17/Aegis/commit/a4e621e99a7a587c705ff892ed80e99ca9c99212))
* add security audit report and social preview assets ([9176620](https://github.com/antropos17/Aegis/commit/91766201bde10eed6b3042709e861e6604dc8a89))
* update project context to v0.8.2-alpha (v16) ([f3d6287](https://github.com/antropos17/Aegis/commit/f3d62875cd06ff4049d2dcdc485282b3c00af1bf))
* update project context to v0.8.2-alpha (v16) ([bab4d7e](https://github.com/antropos17/Aegis/commit/bab4d7e6fff5273feca04b4ce5c77f2080160e69))

## [0.8.2-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.8.1-alpha...aegis-v0.8.2-alpha) (2026-03-08)


### Bug Fixes

* **test:** replace tautological formatBytes tests with boundary and behavioral assertions ([18e1c52](https://github.com/antropos17/Aegis/commit/18e1c52255720311de21ea6e23064de2b1d69403))
* **test:** replace tautological formatBytes tests with boundary and behavioral assertions ([70ebc36](https://github.com/antropos17/Aegis/commit/70ebc3658776510667c26a384542a306b5afacf2))

## [0.8.1-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.8.0-alpha...aegis-v0.8.1-alpha) (2026-03-08)


### Documentation

* document demo mode in README Quick Start section ([947991b](https://github.com/antropos17/Aegis/commit/947991ba15340d0de5db6d4d1bb1b0aba41407c9))
* document demo mode in README Quick Start section ([e125a6c](https://github.com/antropos17/Aegis/commit/e125a6c6c8bf3728b2ac4fbb642336b7d5f52a66)), closes [#76](https://github.com/antropos17/Aegis/issues/76)
* **readme:** add v0.8.0-alpha to release history ([dbc7c21](https://github.com/antropos17/Aegis/commit/dbc7c21b72160e5e6394cdca08dca6412f92321d))
* **readme:** add v0.8.0-alpha to release history, fix CSP description ([8e04eb6](https://github.com/antropos17/Aegis/commit/8e04eb63be5012d9d5d120df6235361127162a0b))
* **readme:** update Star History chart to timeline format ([20bb034](https://github.com/antropos17/Aegis/commit/20bb034a18c4b172f317dac69cc63583f4b2c6f2))
* **readme:** update Star History chart to timeline format ([415c791](https://github.com/antropos17/Aegis/commit/415c79147189a641b30a841c58a518d94bfdeffa))

## [0.8.0-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.7.0-alpha...aegis-v0.8.0-alpha) (2026-03-05)


### Features

* **demo:** enrich demo — 12 agents, 25 events, informative banner ([#69](https://github.com/antropos17/Aegis/issues/69)) ([bd01ac8](https://github.com/antropos17/Aegis/commit/bd01ac87b8888446e77dac223b33cbc937b5b461))
* **demo:** enrich demo with 12 agents, 25 events, informative banner ([a03b7b0](https://github.com/antropos17/Aegis/commit/a03b7b0b4112aac7da5efc58f17566ff56f36a86))
* **demo:** polish all tabs for browser demo — mock data for Rules, Reports, Settings ([d18d95a](https://github.com/antropos17/Aegis/commit/d18d95a17a3b35511c31fe2a4e26a516ce2526d0))
* **demo:** polish all tabs for browser demo ([#68](https://github.com/antropos17/Aegis/issues/68)) ([e41fae2](https://github.com/antropos17/Aegis/commit/e41fae21a63ccded456c5ebac477b897eaba343e))
* **ui:** add skeleton loading states for ActivityTab and RulesTab ([30bbe1b](https://github.com/antropos17/Aegis/commit/30bbe1bab1552414faa4d514b53063e4efda09cb))


### Bug Fixes

* **ipc:** add try-catch to all async ipc handlers ([dc22669](https://github.com/antropos17/Aegis/commit/dc2266922c2b862171ccb6b369d6317164a1f6b6))
* **lint:** use SvelteSet for reactive set in App.svelte ([a4b0cfd](https://github.com/antropos17/Aegis/commit/a4b0cfd6ddded14ffa35124a298fa5024bdfd72f))
* **memory:** add caps to prevAnomalyKeys, knownHandles, eventDedupMap, dnsCache ([b5cde3b](https://github.com/antropos17/Aegis/commit/b5cde3bd72ce1d04672b3cc1c1b92f4f7c61c42b))
* **preload:** return cleanup functions for all IPC listeners ([e0ecd76](https://github.com/antropos17/Aegis/commit/e0ecd765131d5ddadaf2cc4cee7eb18cda258973))
* **ui:** defer ReportsTab rendering to prevent UI freeze ([5f3e03f](https://github.com/antropos17/Aegis/commit/5f3e03f5cc6b72fc35fb8284127c3e9da656ee8c))
* **ui:** fix uptime text overflow and pin feed filters (L1, L2) ([c033572](https://github.com/antropos17/Aegis/commit/c033572605e444714d15b52450e6188cfa854b5a))
* **ui:** improve contrast for warning-level readability issues (W1-W4) ([ee2bf38](https://github.com/antropos17/Aegis/commit/ee2bf389cedd0c960edb624e4feac734fef4bb5b))
* **ui:** layout fixes + skeleton loading states + ReportsTab freeze fix ([858951f](https://github.com/antropos17/Aegis/commit/858951fec96b63eed684764bdd691d561e5fe561))
* **ui:** resolve 7 critical contrast issues (WCAG AA) ([f889c55](https://github.com/antropos17/Aegis/commit/f889c555f4808662f3840db49ae4fa2c34172cf3))
* **ui:** resolve 7 critical contrast issues from visual audit ([e635975](https://github.com/antropos17/Aegis/commit/e6359758e4d79e359110e6ca91f07e9feb440f5d))


### Performance

* comprehensive performance optimization (A-J) ([aaadf08](https://github.com/antropos17/Aegis/commit/aaadf08119cee59d6c1544d17109d06a3e19d718))
* **css:** reduce backdrop-filter from 33 to 5 instances ([77e5374](https://github.com/antropos17/Aegis/commit/77e5374f68baf818b4f60bafd8535f32b2088a85))
* **css:** replace width transitions with transform scaleX ([e63377d](https://github.com/antropos17/Aegis/commit/e63377db57308c830e3f34da963a84374fc2e83e))
* **demo:** stagger initial seeding + delay intervals ([#70](https://github.com/antropos17/Aegis/issues/70)) ([f709d72](https://github.com/antropos17/Aegis/commit/f709d727d4e2290f67cda5dd43cdb752fd4f4b2d))
* **demo:** stagger initial seeding + delay intervals to prevent startup freeze ([c2731f6](https://github.com/antropos17/Aegis/commit/c2731f658c0c8b802716f5543e722df8c4a787ec))
* **ipc:** route stats-update and file-access through existing batchers ([3c1bb4c](https://github.com/antropos17/Aegis/commit/3c1bb4c73e5a2e6b89a882a3419e01ac648aea9f))
* **main:** replace O(n) filters with running counters in getStats ([09ba8e6](https://github.com/antropos17/Aegis/commit/09ba8e6de632725d637d6dcb759195c7b32f8be6))
* **renderer:** coalesce scan-batch store updates into single tick ([58b6827](https://github.com/antropos17/Aegis/commit/58b6827f7ef0f1d9b081ca64d0332d76c3ce5257))


### Code Refactoring

* **renderer:** consolidate 1s timers into shared tick store ([2c46303](https://github.com/antropos17/Aegis/commit/2c46303b346e8a61d3aff8e45feed0c2e7b29503))
* **renderer:** consolidate effects, add rAF cleanup ([7eed9f2](https://github.com/antropos17/Aegis/commit/7eed9f263bf11a215ddea43e2d56bbaded73d7ac))


### Documentation

* Fancy UI screenshots + capture script ([#67](https://github.com/antropos17/Aegis/issues/67)) ([4aa089c](https://github.com/antropos17/Aegis/commit/4aa089ca739f81ab5da9420e06d6dd8e7a84ab16))
* overhaul Download section — honest install, release table, fix 404 GIF ([8297c57](https://github.com/antropos17/Aegis/commit/8297c5740fb5efd701da1f49f044750f7108b8a8))
* sync test counts and versions across all documentation ([ed63d87](https://github.com/antropos17/Aegis/commit/ed63d876a5f19adf159422f581f9a17976b2851a))
* sync test counts and versions across all documentation ([02c3d18](https://github.com/antropos17/Aegis/commit/02c3d18255a057cf5de7bcc3da03bac81cf2702d))
* update README for v0.7.0-alpha (568 tests, YAML rulesets, Fancy UI) ([e533a5c](https://github.com/antropos17/Aegis/commit/e533a5c1d4339b74f80bff016435ff17c0f49ada))
* update README for v0.7.0-alpha (568 tests, YAML rulesets, Fancy UI) ([8fe3e4b](https://github.com/antropos17/Aegis/commit/8fe3e4b47956e6d2f53c850fee9cf429253dee51))
* update screenshots with Fancy UI v0.5.0 ([d04cd99](https://github.com/antropos17/Aegis/commit/d04cd99a9f72d108213bb7bdf4f419f27ed6a53b))
* update screenshots with Fancy UI v0.7.0, add capture script, fix gitignore ([b8acd46](https://github.com/antropos17/Aegis/commit/b8acd460bb17974f3ce56ded7999001f23374514))

## [0.7.0-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.6.0-alpha...aegis-v0.7.0-alpha) (2026-03-04)


### Features

* **rules:** add IPC endpoints + hot-reload watcher for YAML rules [R4] ([e986358](https://github.com/antropos17/Aegis/commit/e986358783d865d88ee8d8890aef5e9f4bd700dd))
* **rules:** add YAML rule loader with JSON Schema validation [R1] ([db2b496](https://github.com/antropos17/Aegis/commit/db2b496f7776a5417c3f5965fdfdb299532aade6))
* **rules:** migrate all SENSITIVE_RULES to typed YAML rulesets [R2] ([20fce07](https://github.com/antropos17/Aegis/commit/20fce07682642ab2c02ed40b5e8eb3c23fb08a23))
* **rules:** wire rule-loader into file-watcher, deprecate SENSITIVE_RULES [R3] ([74500dd](https://github.com/antropos17/Aegis/commit/74500dd76c59bc3edb2080946c49c72297a554e3))
* **rules:** YAML rulesets with hot-reload and IPC (R1-R4) ([3c9072f](https://github.com/antropos17/Aegis/commit/3c9072f8eb81d8df1dae86c23dc74aff8c68aa9d))

## [0.6.0-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.5.0-alpha...aegis-v0.6.0-alpha) (2026-03-03)


### Features

* **ui:** add skeleton loading for pre-scan state ([cf02d81](https://github.com/antropos17/Aegis/commit/cf02d81742a2d3b83aff44085311dd233c5932ba))


### Bug Fixes

* cleanup  timers and reactive loop in Timeline ([8637f5a](https://github.com/antropos17/Aegis/commit/8637f5a43415f98bf8b7c6c6dbc0cc2e40891e53))
* guard getStats against undefined scanner during early IPC ([eba8091](https://github.com/antropos17/Aegis/commit/eba80919665769f923e1b0fd9ee2734a1becdbbd))
* move tray.init to critical path before ready-to-show ([e9972ad](https://github.com/antropos17/Aegis/commit/e9972adfa03af0dc59fdacb08dff268acf4b5b2d))


### Performance

* add depth limits to chokidar watchers (18s-&gt;2s) ([9c5812f](https://github.com/antropos17/Aegis/commit/9c5812faf011bd6730b4fca57a646d73ecc5c5aa))
* batch PowerShell CWD lookup (54 spawns-&gt;1) ([cb414b1](https://github.com/antropos17/Aegis/commit/cb414b158c90a85ee1805c7e6cbef6b6987cea7b))
* defer non-critical module loading until after ready-to-show ([0d1d22e](https://github.com/antropos17/Aegis/commit/0d1d22e2d9dd300e5f2df6c812064a499529254a))
* fix startup freeze + dead code cleanup + renderer optimizations (120s-&gt;1s) ([09bb6ca](https://github.com/antropos17/Aegis/commit/09bb6caf351cc133c3ad92a84de2707ee34b3a73))
* lazy module loading + skeleton UI (eliminate perceived startup lag) ([e3d0880](https://github.com/antropos17/Aegis/commit/e3d088091a434d00f4f1230fcaba5850c8a638fc))
* pre-build events index to eliminate O(N*M) in AgentCard ([12e4772](https://github.com/antropos17/Aegis/commit/12e4772b10455c34368838fd579d426e8c1cab52))
* replace sync fs reads with in-memory counters in loggers ([47a926f](https://github.com/antropos17/Aegis/commit/47a926ff3e823e9727514ba3e05a7bcc8b63c2e3))


### Code Refactoring

* remove 12 dead exports, 11 dead CSS vars, @types/electron ([c7b5f8b](https://github.com/antropos17/Aegis/commit/c7b5f8bd8693298a2b80b4fb603259bae609a58a))
* remove 17 dead IPC channels ([f1555bf](https://github.com/antropos17/Aegis/commit/f1555bf0eaf8813e992d36b7fdb1c444c2bf50ed))


### Documentation

* sync context files for v0.5.0-alpha ([c28b7f7](https://github.com/antropos17/Aegis/commit/c28b7f7e5dd52eca24c9a16177ef5cc476b7088a))
* sync context files for v0.5.0-alpha ([e4d89c9](https://github.com/antropos17/Aegis/commit/e4d89c97fe93a1fa521a10be6d102bf2621a3f4b))

## [0.5.0-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.4.0-alpha...aegis-v0.5.0-alpha) (2026-03-03)


### Features

* add vis-timeline and d3 dependencies ([652917c](https://github.com/antropos17/Aegis/commit/652917c6d0f6b23fe2123ae4b0e6e37c489edab6))
* AgentGraph component with force-directed layout ([1d14ccd](https://github.com/antropos17/Aegis/commit/1d14ccd6458b685373942858787da9a6de128209))
* AgentStatsPanel — sortable agent statistics table ([6108ed5](https://github.com/antropos17/Aegis/commit/6108ed5bee594fb13a84b10b1ebe7a7e460b9b23))
* EventFeed — live terminal-style event stream ([5b1b61a](https://github.com/antropos17/Aegis/commit/5b1b61aeb00f316ddd28b09c1258c67c05ca04f2))
* fancy aegis UI redesign v0.5.0-alpha (F1.1-F4.3) ([f5c461c](https://github.com/antropos17/Aegis/commit/f5c461c534f64e64939b946fb3dd34e71fdf6076))
* move Timeline and Graph to separate tabs with bug fixes ([acc99b1](https://github.com/antropos17/Aegis/commit/acc99b15f1ac2c2c4aad7a47ade468a92e730ae9))
* Stats tab, cleanup Timeline/Feed, Follow in Activity (#timeline-graph) ([752a6d8](https://github.com/antropos17/Aegis/commit/752a6d8b1208a4a80c3390c31f608529a92565fd))
* **ui:** add background atmosphere effect [F4.3] ([6306d19](https://github.com/antropos17/Aegis/commit/6306d19824e22f974630672c727bad857f62a760))
* **ui:** add design system tokens and local fonts [F1.1] ([7c6fec6](https://github.com/antropos17/Aegis/commit/7c6fec620827861149df89961a3c0e2e8bb85012))
* **ui:** add feed item animations and severity colors [F3.1] ([fdb2544](https://github.com/antropos17/Aegis/commit/fdb2544f7d66a1d78467e1abcb917febf39062e6))
* **ui:** add footer mini charts for CPU and memory [F3.2] ([3a1fa6d](https://github.com/antropos17/Aegis/commit/3a1fa6d0d50d801f853205a390843733dba860b8))
* **ui:** add risk ring SVG gauge with glow and pulse [F4.1] ([fe08cad](https://github.com/antropos17/Aegis/commit/fe08cad1dff7818a2d3326d1d6a5be2d15d80d47))
* **ui:** add sparkline SVG component [F2.1] ([b29e24a](https://github.com/antropos17/Aegis/commit/b29e24a04e2a0f0ebdd7653c66df514f6f5aa478))
* **ui:** add summary cards component with animated counters and trend arrows [F1.3] ([909e7b3](https://github.com/antropos17/Aegis/commit/909e7b349da2fd9f57a17773e56627255266c412))
* **ui:** add summary cards component with threat metrics [F1.3] ([42f7e76](https://github.com/antropos17/Aegis/commit/42f7e76a103f52832e5a4f3bd0cfc2e1cf158236))
* **ui:** add tab switch transitions [F3.3] ([01d4c2d](https://github.com/antropos17/Aegis/commit/01d4c2d02b426b613e70c153eec400dfdaa38e51))
* **ui:** add trust badge component [F2.2] ([60ef2ed](https://github.com/antropos17/Aegis/commit/60ef2edf0b1e82c03044ebf58eb8ff54df7de151))
* **ui:** redesign agent card with sparkline, badge, spotlight [F2.3] ([3ccd1b5](https://github.com/antropos17/Aegis/commit/3ccd1b5fa0270edaebdb9c913b49ec8b2c30989f))
* **ui:** redesign Shield tab with bento grid layout [F1.2] ([06b876d](https://github.com/antropos17/Aegis/commit/06b876d5ceda1d76531480d3ba326bc1bbe837e4))
* **ui:** typography pass — consistent font tokens across all components [F4.2] ([cbf8446](https://github.com/antropos17/Aegis/commit/cbf844656eaeced81b24fae22a55db53c4217b14))
* VisTimeline component with agent groups and event items ([b7adbe0](https://github.com/antropos17/Aegis/commit/b7adbe0e3abd8a0bdab8654a44c55f01d861d172))


### Bug Fixes

* clean up tab navigation ([8893d84](https://github.com/antropos17/Aegis/commit/8893d84fd517f07ee64b0aa20e6f1fb4f66f6271))
* convert svelte components to JSDoc style for eslint compatibility ([13dd271](https://github.com/antropos17/Aegis/commit/13dd2716002539aad6af341f8b57dfcef153f166))
* **lint:** configure eslint-plugin-svelte with TypeScript parser ([45e4343](https://github.com/antropos17/Aegis/commit/45e434356ba5f430dfd9f4a1cbbb5d8adaabac08))
* **lint:** configure eslint-plugin-svelte with TypeScript parser ([f91c721](https://github.com/antropos17/Aegis/commit/f91c72122054f140bba41af754d6591a4f7dbb49))
* remove Event Timeline from Shield tab ([a58144c](https://github.com/antropos17/Aegis/commit/a58144cd2c2542b53c44343b9ab920b4061dcf4e))
* tune graph simulation forces and layout (WIP) ([a8a8773](https://github.com/antropos17/Aegis/commit/a8a8773eaeaa6027d2b816230f9abc9eefc9bc3f))


### Code Refactoring

* integrate VisTimeline into main dashboard ([b84d734](https://github.com/antropos17/Aegis/commit/b84d7344e9d825931bfbf78689e1aa8f04984cc4))
* merge Feed into Activity tab ([6acb3e7](https://github.com/antropos17/Aegis/commit/6acb3e7f5c2c26baff9a8851dd606bda48ff680c))
* update tab navigation (Stats + Feed) ([33a4d70](https://github.com/antropos17/Aegis/commit/33a4d7069f7d142ecf36c5a25abd4225220b7f3c))


### Documentation

* polish README for Dev.to launch — tighten badges, update test count to 489, clean changelog ([5b5d9f4](https://github.com/antropos17/Aegis/commit/5b5d9f491a2174a1bf417361d85aa5d3cafd5e66))
* sync context files for v0.4.0-alpha — update counts, version, limits ([cc1a362](https://github.com/antropos17/Aegis/commit/cc1a362327d1de682451f78d030970d619e6f1d3))
* update context for Stats tab and tab cleanup ([ab82f90](https://github.com/antropos17/Aegis/commit/ab82f90000783e37171999518ca95d908633edc8))

## [0.4.0-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.3.1-alpha...aegis-v0.4.0-alpha) (2026-03-03)


### Features

* add JSDoc type annotations using shared type definitions ([a737a08](https://github.com/antropos17/Aegis/commit/a737a084de64bc95aa6298ea1df719c9e6eb1601))
* add TypeScript type definitions for all data structures ([f36fea9](https://github.com/antropos17/Aegis/commit/f36fea9d33da676ee4215eb8b0f2d4427a173c77))
* redesign AgentCard, FeedFilters, and Timeline UI ([d177e68](https://github.com/antropos17/Aegis/commit/d177e687a3c23cf9019b7f7a05cf216dc5773b1f))
* TypeScript infrastructure — tsconfig, 34 types, ESLint TS, ESM test migration, JSDoc annotations (P5-B.0) ([c480a73](https://github.com/antropos17/Aegis/commit/c480a73d4dacaf7d13db859ff0b2142a24ecd3cc))


### Bug Fixes

* add missing await in ipc-handlers.test.js:346 ([0570652](https://github.com/antropos17/Aegis/commit/0570652f4fec77a72f2e8900395146f0e9ac7179))
* add PID validation to POSIX platform functions and IPC boundary ([b0fc17b](https://github.com/antropos17/Aegis/commit/b0fc17b560cfab55c70aed5264203312a9004cd9))
* deduplicate agents in dropdowns, cards, and reports table ([73b55a1](https://github.com/antropos17/Aegis/commit/73b55a1e3e7c71f33f1b49be4e985e99b2675483))
* platform index test compares export shape instead of function toString (CJS/ESM interop) ([fa75cb4](https://github.com/antropos17/Aegis/commit/fa75cb442b6cc5c9bee409929b72de380db8a26f))
* platform index test uses function identity comparison compatible with CJS/ESM interop ([5690d5d](https://github.com/antropos17/Aegis/commit/5690d5d2991306b9f19f4f1e572f21b7f98d4b7f))
* resolve a11y and CSS build warnings ([6a91fff](https://github.com/antropos17/Aegis/commit/6a91fff12b57339fc90c69a9f707d8afd34402e7))


### Performance

* eliminate dev server fallback on production start (~2s boot improvement) ([dbe466e](https://github.com/antropos17/Aegis/commit/dbe466e146179792057f02e32b934ebddbfbd348))
* eliminate tab switch lag — show/hide pattern, IPC batching, enrichedAgents cache ([c29f593](https://github.com/antropos17/Aegis/commit/c29f5935b2d6022f6dc7a2d3b243ec33b9508396))
* reduce IPC flood at startup — chokidar exclusions, warmup ramp-up, network debounce, stats batch 1s ([8106bee](https://github.com/antropos17/Aegis/commit/8106beedfd1a0b56e48943e1d695423414cd110d))
* skip store updates in hidden tabs — active prop propagation ([b2cfde9](https://github.com/antropos17/Aegis/commit/b2cfde9ef4eef8a10c2ec37ae885f3fca26735b7))
* skip store updates in hidden tabs — active prop propagation ([fc50527](https://github.com/antropos17/Aegis/commit/fc50527961837886a47b4766e7bdef772d9c6b3d))


### Code Refactoring

* split AgentDatabaseCrud.svelte into sub-components ([a3bb506](https://github.com/antropos17/Aegis/commit/a3bb506d1398a0ffc182092f2b7a5fbd6808ee7e))
* split GroupedFeed.svelte into sub-components ([e71d24f](https://github.com/antropos17/Aegis/commit/e71d24f6a470d471e055f1cd05a44fe8a670c6c3))
* split Timeline.svelte into sub-components ([36b1999](https://github.com/antropos17/Aegis/commit/36b1999184efba2fa278f180cf133b49c9d5d79f))


### Documentation

* add TypeScript guidelines to CONTRIBUTING.md ([0d8345a](https://github.com/antropos17/Aegis/commit/0d8345a924adbe42ef28d545383d9a3fd7b2132a))
* add TypeScript rules to CLAUDE.md ([cd75102](https://github.com/antropos17/Aegis/commit/cd75102c284147ffe415b67af8c13d5bfce37791))
* post-release badges, links, counts update for v0.3.1-alpha ([940cded](https://github.com/antropos17/Aegis/commit/940cded42a52b44d888eda29b5a838d834ba0d60))
* update context files for P5-B.0 completion, boot perf fix, and TS workflow ([38c2180](https://github.com/antropos17/Aegis/commit/38c2180bd85fc1901e8e6a27672248f8017888bf))
* update test count to 489, add Skills section to CLAUDE.md ([384bcc0](https://github.com/antropos17/Aegis/commit/384bcc00f39e07749f5e6ab06088ccc101b83b57))

## [0.3.1-alpha](https://github.com/antropos17/Aegis/compare/aegis-v0.3.0-alpha...aegis-v0.3.1-alpha) (2026-03-02)


### Features

* **a11y:** add keyboard shortcuts and accessibility improvements ([#51](https://github.com/antropos17/Aegis/issues/51)) ([8a996e4](https://github.com/antropos17/Aegis/commit/8a996e407508352ad3d15d4acb15fbfa0bd56505)), closes [#17](https://github.com/antropos17/Aegis/issues/17)
* activity feed process grouping with expandable details ([c573b69](https://github.com/antropos17/Aegis/commit/c573b69c4cc62dde1ba86f5df0f70130b8972e63))
* AEGIS v0.1.0-alpha — AI Agent Privacy Shield ([a398591](https://github.com/antropos17/Aegis/commit/a3985910faaa41426d822c6464d427a4a6d3d53e))
* **agents:** add 8 new agent signatures to database ([#50](https://github.com/antropos17/Aegis/issues/50)) ([484353f](https://github.com/antropos17/Aegis/commit/484353fb20bf39e3be0cea1f311b44e4dc91ba0e))
* **ci:** automated releases with release-please ([#58](https://github.com/antropos17/Aegis/issues/58)) ([7120694](https://github.com/antropos17/Aegis/commit/7120694a785413b55b3471dc3d55b646bb59b86c))
* clickable file paths (reveal in explorer) + copyable network addresses ([e0fd69c](https://github.com/antropos17/Aegis/commit/e0fd69c4f3b55c44b438235c938a5146f918037b))
* **community:** false positive marking, agent DB contribution, scan badge (#P4.15-17) ([73851fc](https://github.com/antropos17/Aegis/commit/73851fc5f760252087aa1df8e451a9dceb1394cb))
* container/VM + local LLM detection (88→95 agents) ([dbfa1c1](https://github.com/antropos17/Aegis/commit/dbfa1c10bd853149b58dfb8efff69d87a758d38f))
* **core:** HTTP scoring, user-agent detection, API indicator, HW accel toggle (#P4.11-14) ([e7d3958](https://github.com/antropos17/Aegis/commit/e7d39584dfe8e9ba3eaa461f0e1d76774c8038f4))
* cross-platform support (macOS/Linux), unified UI scaling, and comprehensive test suite ([#37](https://github.com/antropos17/Aegis/issues/37)) ([4abfe6f](https://github.com/antropos17/Aegis/commit/4abfe6fe436a1383a3e47fe14f988cd8d4aab067))
* **demo:** add browser-only demo mode and development guide (closes [#10](https://github.com/antropos17/Aegis/issues/10)) ([d8e682d](https://github.com/antropos17/Aegis/commit/d8e682dc5bdb995f991d3eb53327cb3205d16da7))
* **demo:** add browser-only demo mode with simulated agent data ([1269416](https://github.com/antropos17/Aegis/commit/12694167c2ff5164897227f5ebfc0222cf20a944)), closes [#10](https://github.com/antropos17/Aegis/issues/10)
* **detection:** add local LLM runtime detection (Ollama, LM Studio, vLLM, llama.cpp) — 97 agents ([84a0e99](https://github.com/antropos17/Aegis/commit/84a0e99894d5f03268c2632b22460c5c85f3c55c))
* expand agent database with Qwen-Agent, CodeWhisperer aliases, Gemini CLI patterns ([#46](https://github.com/antropos17/Aegis/issues/46)) ([d589c3f](https://github.com/antropos17/Aegis/commit/d589c3f207d6b5f88648fb28352f2730e4d4f71f))
* **file-watcher:** add configurable ignore list for .git/node_modules ([#11](https://github.com/antropos17/Aegis/issues/11)) ([febc626](https://github.com/antropos17/Aegis/commit/febc626055879d33435f326c197de815b3c5ceb3))
* **i18n:** add internationalization support with English base ([b967a74](https://github.com/antropos17/Aegis/commit/b967a7416745415c2efe2aa5199beeb0afc0899d))
* **i18n:** add internationalization support with English base ([#53](https://github.com/antropos17/Aegis/issues/53)) ([8b82929](https://github.com/antropos17/Aegis/commit/8b829296f0a8ae1b074f0daccdd815bf6a33fb1c))
* **i18n:** add internationalization support with English base ([#53](https://github.com/antropos17/Aegis/issues/53)) ([71ea7d3](https://github.com/antropos17/Aegis/commit/71ea7d322a1f62541b4b67f191ed42fe6f3ef3fb))
* integrate LLM runtime detection into scan pipeline + CLI JSON output (--scan-json) ([2ae6b02](https://github.com/antropos17/Aegis/commit/2ae6b02b878a7532e033159a3b11eaaef3eb0dd7))
* **ipc:** add event batching to prevent UI freeze on high-frequency events ([48063cd](https://github.com/antropos17/Aegis/commit/48063cd586d016b27ad28a57b830f9825575e06c))
* multi-dimensional scoring, LLM runtime detection, CLI ([d28fa3b](https://github.com/antropos17/Aegis/commit/d28fa3b0a3458674b574d666e3e8f8c971b943f6))
* Phase 1 — AI agent config file protection (Hudson Rock threat vector) ([3936c50](https://github.com/antropos17/Aegis/commit/3936c501823c2b8aa8d79a27d6ea3bebbaf419bc))
* Phase 2 — behavioral anomaly detection with baseline deviation alerts ([ddb9e8c](https://github.com/antropos17/Aegis/commit/ddb9e8c25d4cc9c59f8951b89a0b568230b19b29))
* Phase 3 — AI-powered threat analysis via Anthropic API ([3af65c5](https://github.com/antropos17/Aegis/commit/3af65c5694f0692be5b4ab0978f4ae1887684009))
* Phase 4+5 — real-time timeline, dashboard metrics, persistent audit logging ([a332209](https://github.com/antropos17/Aegis/commit/a332209792296aa417d22179d746ddea60415961))
* **scoring:** multi-dimensional anomaly scoring (network/fs/process/baseline) ([26d3e64](https://github.com/antropos17/Aegis/commit/26d3e647861f739564078952a8cd03a32418b2d9))
* show unique agent count vs process count in header and reports ([#55](https://github.com/antropos17/Aegis/issues/55)) ([0a57d45](https://github.com/antropos17/Aegis/commit/0a57d452654461b8b38b42043ca63475e740c48e)), closes [#53](https://github.com/antropos17/Aegis/issues/53)
* solar system radar with lightning effects ([407b061](https://github.com/antropos17/Aegis/commit/407b06165364df0a5df24374cef53fa0a550cb22))
* toast notification system ([#15](https://github.com/antropos17/Aegis/issues/15)) ([11fec75](https://github.com/antropos17/Aegis/commit/11fec756be1cd3d7f71ed89d1ceaca9b97111820))
* **ui:** copy PID, relative time, path truncation, autoscroll (#P4.1-5) ([922fdbd](https://github.com/antropos17/Aegis/commit/922fdbd88b99d7160a5255cc919a7c0ed66f42a0))
* **ui:** threat flash, hotkeys, open location, OOM protect, zip export (#P4.6-10) ([be898a2](https://github.com/antropos17/Aegis/commit/be898a241c0fed5ff5b9db89f27035a4e0215f10))


### Bug Fixes

* address critical issues from PR [#37](https://github.com/antropos17/Aegis/issues/37) code review ([3ab4fac](https://github.com/antropos17/Aegis/commit/3ab4fac6c541c485331d8c5bde6dc7ae0d45e29f))
* correct author name ([921f2d2](https://github.com/antropos17/Aegis/commit/921f2d26f737300fbe2e2a730840ad3728b1c47d))
* critical issues from PR [#37](https://github.com/antropos17/Aegis/issues/37) code review ([f43a7e9](https://github.com/antropos17/Aegis/commit/f43a7e97156da3f6d3adf6af3b1ef8788f904f38))
* **docs:** update test counts, productName, lint rule ([235f493](https://github.com/antropos17/Aegis/commit/235f493a534cac749e5d0190b28e43ddae455a24))
* group agent cards by name, show PIDs inside expand ([c7b5800](https://github.com/antropos17/Aegis/commit/c7b58004b50d333a33313e26ed8d85d2f67f3764))
* integrate annotateWorkingDirs into periodic and startup scan pipelines ([#44](https://github.com/antropos17/Aegis/issues/44)) ([72a3022](https://github.com/antropos17/Aegis/commit/72a30229e1afc6b681dd1ad268f75efea0999169)), closes [#2](https://github.com/antropos17/Aegis/issues/2)
* lazy init settings/baselines path — resolve app.getPath crash on startup ([8ca7817](https://github.com/antropos17/Aegis/commit/8ca78177c40cc02cd10c068876bd5d3ccb176011))
* port risk scoring rebalance to Svelte + remove legacy files ([207eb5c](https://github.com/antropos17/Aegis/commit/207eb5c623923bef06b55e2f9cc4ac566c9eeb94))
* radar canvas visibility — increase grid/label/sweep opacity ([052af52](https://github.com/antropos17/Aegis/commit/052af5220f92062d1a7bd25e2a8306fd0e8a5472))
* radar canvas visibility — increase grid/label/sweep opacity for dark theme ([72980fb](https://github.com/antropos17/Aegis/commit/72980fb4960c47e864668e147d72bc6421cc82c3))
* radar centering + light theme visibility ([07511f8](https://github.com/antropos17/Aegis/commit/07511f8821e5684d7477d8b6a995b1203d0c5a6d))
* radar dark background ([2e5403a](https://github.com/antropos17/Aegis/commit/2e5403a764a85b7a0871d7cc540e6e2cf24491bc))
* rebalance risk scoring — self-access exemption, dedup, diminishing returns ([054ff8b](https://github.com/antropos17/Aegis/commit/054ff8baca086802ce1b2cd4526395b3f5c73201))
* remove duplicate/wrong author name ([9afe1a2](https://github.com/antropos17/Aegis/commit/9afe1a2547faa7ad76bd42a3321e23e04d3f4894))
* remove unused path import in anomaly-detector ([950677a](https://github.com/antropos17/Aegis/commit/950677a28c78a1fadc1c4c15dc850235e13d2906))
* remove WSL from agent DB, add event dedup (30s window) ([7b1b5cf](https://github.com/antropos17/Aegis/commit/7b1b5cf2680951b3b45f7e47224b0b89be8d0be6))
* replace hardcoded colors with design tokens, update docs ([1cd9945](https://github.com/antropos17/Aegis/commit/1cd9945d10b3d338ab1023c42e53d739fbe781b8))
* resolve 10 UI bugs from full audit ([4607c9b](https://github.com/antropos17/Aegis/commit/4607c9b58cfe687c28a057e96a078022924ac514))
* resolve 4 HIGH issues from PR [#37](https://github.com/antropos17/Aegis/issues/37) code review ([#41](https://github.com/antropos17/Aegis/issues/41)) ([700486c](https://github.com/antropos17/Aegis/commit/700486c72ce5948a9aa39cee3f9a11235b9ca8db))
* resolve black screen in packaged exe (CSP + path fix) ([c42839b](https://github.com/antropos17/Aegis/commit/c42839bbac70c0a2b55773f9fba43088eb748eb0))
* resolve PR [#52](https://github.com/antropos17/Aegis/issues/52) review — CSS dupe, cleanup leak, split demo-pools, add tests ([1ed2237](https://github.com/antropos17/Aegis/commit/1ed22376720f8686274059c2f4cac2fe4797e98c))
* robust JSON extraction for AI threat analysis ([40a5930](https://github.com/antropos17/Aegis/commit/40a5930c766567caf5e9cf27f602b49202d748db))
* **scanner:** graceful EPERM handling prevents crash on elevated processes ([c42a483](https://github.com/antropos17/Aegis/commit/c42a483c1dc7be7e5d065cd134222d40949bac00))
* settings modal — add export/import config buttons ([25ff634](https://github.com/antropos17/Aegis/commit/25ff634e96f937582d2d98eab9f5ae9a6adc6de4))
* split oversized files, fix bg flash, cleanup, update CLAUDE.md ([e089e4b](https://github.com/antropos17/Aegis/commit/e089e4b9dc4242b3857eff38d80ad04ff24cb660))
* threat analysis JSON parsing, table header overlap, version bump ([577ff7c](https://github.com/antropos17/Aegis/commit/577ff7c586aa6ec33ece445fac69b98a6b431968))
* **ui:** replace hardcoded rgba colors with design tokens + eslint-plugin-svelte ([566f251](https://github.com/antropos17/Aegis/commit/566f2512f21b3cff17522f8d1e2537c284217e7c))
* unset ELECTRON_RUN_AS_NODE in start script for IDE terminal compatibility ([ee4b65a](https://github.com/antropos17/Aegis/commit/ee4b65abafc890b7792ba1d6335c96f0d1888833))


### Performance

* defer file watchers and lazy-load modules for faster startup ([e6a87cd](https://github.com/antropos17/Aegis/commit/e6a87cdebc7e39535d5f8c4e77ece847715fe104))
* defer non-critical startup ops phase 2 (+150-400ms) ([4390ca3](https://github.com/antropos17/Aegis/commit/4390ca3456754c6d8edeea6902b868870c07444d))


### Code Refactoring

* DRY platform code + align test API contracts ([#43](https://github.com/antropos17/Aegis/issues/43)) ([6cb45b7](https://github.com/antropos17/Aegis/commit/6cb45b7b9a3613ae6277d28c3a3d5237adfbe9bc))
* extract IPC handlers from main.js + fresh screenshot ([1e75bbb](https://github.com/antropos17/Aegis/commit/1e75bbb52783f1d8f920a4729010beaa38fef872))
* simplify — align all components to M3 tokens ([c968e23](https://github.com/antropos17/Aegis/commit/c968e236c10e76b9a606307188c1ae46fcd29987))
* simplify AgentCard — extract gradeToColor, consolidate pidAction ([1db102d](https://github.com/antropos17/Aegis/commit/1db102d26e530acd888a6fb49bb5ab53441ed570))
* simplify steps 12-15 ([09e60a5](https://github.com/antropos17/Aegis/commit/09e60a54c34ffe9c1ecc9c9bbd596a7b340328a5))
* split 4 large files into focused modules ([578c490](https://github.com/antropos17/Aegis/commit/578c49096a7f907d1a4368c3663aa36d6ee08048))
* split 4 large files into focused modules ([d6fccff](https://github.com/antropos17/Aegis/commit/d6fccff24048dad643fd3d620d6b090e4e253e92)), closes [#3](https://github.com/antropos17/Aegis/issues/3)


### Documentation

* add AGENTS.md for AI agent contributors ([4fa07f1](https://github.com/antropos17/Aegis/commit/4fa07f14b7a959e7f72c6bd63129b9779ad7b4f6))
* add animated demo GIF to README ([#34](https://github.com/antropos17/Aegis/issues/34)) ([dc8c97a](https://github.com/antropos17/Aegis/commit/dc8c97acbb0d26a73300fa875ed34567f2cf5ad0))
* add CHANGELOG.md (Keep a Changelog format) ([220596e](https://github.com/antropos17/Aegis/commit/220596efbf3810a7d1ab8193f3a4206bdb8836b6))
* add CI badge to README ([8c1b8ef](https://github.com/antropos17/Aegis/commit/8c1b8ef10cfa3d3a4349d859e4199db833c6e6e2))
* add competitor comparison table ([cf452dd](https://github.com/antropos17/Aegis/commit/cf452dd72814a82cba5018145ad3ce8093333bf2))
* add development guide with tech stack best practices ([988c48d](https://github.com/antropos17/Aegis/commit/988c48d32295dda9588167cd0fc09a22cbe22658))
* add ROADMAP.md with master plan ([df67dee](https://github.com/antropos17/Aegis/commit/df67dee5d46b5eba9a910f67757a615de14a1270))
* add SUPPORT.md, label good-first-issues ([b4d1d85](https://github.com/antropos17/Aegis/commit/b4d1d85ea0046183cd7593e118d08e561ee3cf36))
* add test groups breakdown table to README ([0093b1c](https://github.com/antropos17/Aegis/commit/0093b1c2d43b88b6a4495763a734042ec4aa8858))
* add travisbreaks to contributors, update agent count to 106 ([e8ccaf0](https://github.com/antropos17/Aegis/commit/e8ccaf0645785830d33d4608f8850da01589c942))
* add trimmed demo GIF for README ([7c08bea](https://github.com/antropos17/Aegis/commit/7c08bea219f1cb8821a3f1aee54984724e46b3e7))
* add trimmed demo GIF to README ([#34](https://github.com/antropos17/Aegis/issues/34)) ([138da08](https://github.com/antropos17/Aegis/commit/138da08eebadc109ff0ce30cd30156ae582451ec))
* add UI screenshots for Activity, Rules, Reports, Settings ([d934722](https://github.com/antropos17/Aegis/commit/d9347227b1a580a9746a72fac55efb685ceb6522))
* add UI screenshots for all tabs ([#34](https://github.com/antropos17/Aegis/issues/34)) ([7214196](https://github.com/antropos17/Aegis/commit/72141961670a6a4b05d1f985c942d45af09b83b0))
* add UI screenshots to README ([419a386](https://github.com/antropos17/Aegis/commit/419a3863fac5e2a382e51f2b7431a0dff3b76f2e))
* bump supported version to 0.3.x in SECURITY.md ([40e3f32](https://github.com/antropos17/Aegis/commit/40e3f323740e20083d71e3b37a867431dd9bc07c))
* fix all placeholders, outdated info, and garbled UTF-8 for public launch ([28bce5a](https://github.com/antropos17/Aegis/commit/28bce5ac74be18f1290d4f77624f7d52c70dbd02))
* fix case-sensitive dir name in CONTRIBUTING.md ([9f36bb2](https://github.com/antropos17/Aegis/commit/9f36bb26a97e9008ff480db20acf0d83ba25b43a))
* fix stack description — Svelte 5, not vanilla JS ([0fc5ca2](https://github.com/antropos17/Aegis/commit/0fc5ca2c5dd0d5f264bc6d1c31219e8b86e858af))
* polish README for public launch ([f07d79e](https://github.com/antropos17/Aegis/commit/f07d79ec2520470b91dfa4cff78ea767bce9e123))
* polish README, fresh screenshots, update contributors and changelog ([1470407](https://github.com/antropos17/Aegis/commit/1470407d649914a5acad0d65c3a4cb8e1cf8cabe))
* pre-release update all documentation for v0.3.1-alpha ([bb4a8e1](https://github.com/antropos17/Aegis/commit/bb4a8e1829c0f96a639f5cd7b4a51da7875a95f4))
* README download section + rebuild installer with radar fix ([d948897](https://github.com/antropos17/Aegis/commit/d9488977dfc559d7b51505950c448b37523ff8a6))
* README, CONTRIBUTING, SECURITY, ARCHITECTURE — Independent AI Oversight Layer ([e276229](https://github.com/antropos17/Aegis/commit/e276229d2aaa6bf64729d6a42a57863ef015a3a6))
* README, CONTRIBUTING, SECURITY, ARCHITECTURE for open-source launch ([7df67c2](https://github.com/antropos17/Aegis/commit/7df67c26c1ed3527f285d4872f40ee1a338a9e8b))
* update AGENTS.md — 106 agent signatures ([713ba5a](https://github.com/antropos17/Aegis/commit/713ba5aec9a708d9ef7828238d26d00f28a27460))
* update AGENTS.md + CLAUDE.md for llm-runtime-detector, cli.js, 98 agents ([b2b7805](https://github.com/antropos17/Aegis/commit/b2b78055c6f17d9adca2de025f440d4155545a14))
* update ARCHITECTURE.md — 106 agents, 49 IPC channels, add toast store ([e0cdb8b](https://github.com/antropos17/Aegis/commit/e0cdb8bf7692b49b8ce1cb0f762733390a8bc448))
* update ARCHITECTURE.md to match Svelte codebase and current features ([4506a51](https://github.com/antropos17/Aegis/commit/4506a514380119adad8d4253a2613e81885dfe69))
* update audit docs — add resolution status tables for v0.3.0-alpha ([822104e](https://github.com/antropos17/Aegis/commit/822104ed2ef493277fed8859a7434f0d7e796526))
* update CHANGELOG.md — add Unreleased section, fix counts to 106 agents 436 tests ([2bf6267](https://github.com/antropos17/Aegis/commit/2bf62678cdcc84634d53fa10407f76dc1fc1035b))
* update CLAUDE.md — 106 agents, 429 tests ([964fd8d](https://github.com/antropos17/Aegis/commit/964fd8dc11c86aba02a4dd8322428209ad22503d))
* update CLAUDE.md — 436 tests, 19 modules, 32 components, 39 IPC channels ([c608122](https://github.com/antropos17/Aegis/commit/c6081224cda34e09b7e1516bfba1910127d8a0e2))
* update memory-bank notes ([708cfb2](https://github.com/antropos17/Aegis/commit/708cfb2489613a7f9b9a24fa6e9b4d31cdc7053b))
* update progress after github push ([326b6dd](https://github.com/antropos17/Aegis/commit/326b6dda565bcc053907a85bae633d9d359d1e27))
* update README for v0.2.0-alpha Svelte stack ([447f9d0](https://github.com/antropos17/Aegis/commit/447f9d073b3fda6f8f77d1cdeceebb8fb315e08c))
* update README.md — 106 agents, 436 tests, fix template links, add demo mode ([c3d7e7d](https://github.com/antropos17/Aegis/commit/c3d7e7dd5edfc69504c5aad501aa042fd5b0f1dc))
* update screenshot for launch ([df1b352](https://github.com/antropos17/Aegis/commit/df1b352ef16e8ccf1a19b65863b7d95a3cab0db8))
* update test counts and changelog for EPERM handling ([ff66877](https://github.com/antropos17/Aegis/commit/ff66877dd51df3258d5505a592ab50bbe682ca6e))
* update test counts and changelog for IPC batching ([823db91](https://github.com/antropos17/Aegis/commit/823db91b6efe9a9480db608729b0516c1b664550))
* update test counts and changelog for startup perf fix ([8c384a1](https://github.com/antropos17/Aegis/commit/8c384a12dfe0da8e2aa20de8e7dc3024e198e05a))

## [0.3.0-alpha] - 2026-02-28

### Added
- Multi-dimensional anomaly scoring (4 axes: Network, FileSystem, Process, Baseline)
- Local LLM runtime detection (Ollama localhost:11434, LM Studio localhost:1234)
- CLI interface with JSON output (--scan-json, --version, --help)
- 106 agent signatures including local-llm-runtime category
- 408 tests across 25 test files (up from 130/12)
- Dynamic version display in Footer via IPC
- Contributors section in README with avatars
- Trust signal badges, Table of Contents, navigation bar
- "What AEGIS Does / Does NOT Do" section
- "Building from Source" section
- Star History chart
- CODEOWNERS file
- FUNDING.yml

### Changed
- README completely rewritten following open-source best practices
- All badges unified to flat-square style
- Screenshots moved from screenshots/ to docs/screenshots/

### Fixed
- Hardcoded version in Footer.svelte → dynamic IPC-based
- Agent count: 94 → 98 across all files
- Test count: 130/12 → 408/23
- Removed completed items from Roadmap (electron-builder, Mac/Linux, local LLMs)

## [0.2.0-alpha] - 2026-02-24

### Added
- Full Svelte 5 + Vite 7 rewrite with `$state`/`$derived`/`$effect` runes replacing vanilla JS renderer
- IPC bridge as Svelte reactive stores (`ipc.js`, `risk.js`, `theme.js`)
- 4-tab navigation: Shield, Activity, Rules, Reports
- Canvas radar with agent dots, sweep arm, connection lines at 60fps
- Risk scoring derived store with weighted time-decay model and trust grades (A+ through F)
- Agent card expandable details with sparklines, session duration, parent chain, and action tabs
- SVG horizontal timeline in Shield tab (last 100 events as color-coded dots)
- Network panel with Feed/Network toggle in Activity tab
- Activity feed process grouping with expandable details
- Clickable file paths (reveal in explorer) and copyable network addresses
- AI agent config file protection for 27 agent config directories (Hudson Rock threat vector)
- Behavioral anomaly detection with baseline deviation alerts (5 weighted factors, 0-100 scoring)
- AI-powered threat analysis via Anthropic API (per-agent and full session analysis)
- Real-time timeline, dashboard metrics, persistent JSONL audit logging with daily rotation
- Container/VM and local LLM detection expanding agent database from 88 to 95 agents
- Settings modal with export/import config buttons
- CSP header and network connections store cap (500 max)
- Protection presets (Paranoid/Strict/Balanced/Developer) and per-agent permissions grid
- Agent Database Manager with custom add/edit/delete and import/export
- Reports tab with aggregate stat cards, JSON/CSV/HTML export, and audit log viewer
- Printable HTML threat reports
- GitHub Actions CI/CD lint + build workflow
- electron-builder config for Windows NSIS installer with procedural shield icon
- macOS build compatibility
- GitHub issue templates, PR template, CODE_OF_CONDUCT
- Responsive min-width and electron window constraints
- Tab transitions and micro-interactions
- M3 design tokens with neumorphic glassmorphism (Plus Jakarta Sans + DM Sans + DM Mono)
- UI screenshots added to README for all tabs
- README, CONTRIBUTING, SECURITY, ARCHITECTURE docs for open-source launch
- CI badge in README

### Fixed
- Risk scoring rebalance — self-access exemption, dedup, diminishing returns
- Radar canvas visibility — increased grid/label/sweep opacity for dark theme
- Radar centering and light theme visibility
- Black screen in packaged exe (CSP + path fix)
- Threat analysis JSON parsing and robust JSON extraction
- Table header overlap in threat analysis view
- `sendToRenderer` crash on shutdown
- Hardcoded `#fff` colors in 4 Svelte components breaking dark theme
- Removed WSL from agent DB, added event dedup (30s window)
- `icon.ico` to `icon.png` for electron-builder NSIS packaging
- Lazy init settings/baselines path — resolved `app.getPath` crash on startup
- Unset `ELECTRON_RUN_AS_NODE` in start script for IDE terminal compatibility
- Dev server port fixed to 5174
- Nested ternary in Header, dead import in Footer
- Duplicate/wrong author name in package metadata
- CI YAML syntax error in lint step
- 10 UI bugs resolved from full audit pass

### Changed
- Complete UI rewrite from vanilla JS to Svelte 5 component architecture (22 components)
- Premium dark minimal redesign with glassmorphism panels, blur, translucent surfaces
- Header compact redesign with shield score, agent/file counts, theme toggle
- Footer merged with system stats (version, uptime, MEM/HEAP/SCAN)
- Agent card compact redesign with trust bars and grouped-by-name display
- Shield tab bento grid layout
- Activity tab compact feed with network panel merged
- Rules tab visual polish with presets/permissions/database sections
- Extracted IPC handlers from main.js into dedicated modules
- Renamed `app.html` to `index.html` and updated Vite config
- Removed legacy vanilla JS renderer and old CSS
- Cleaned config-manager.js and aligned all components to M3 tokens

## [0.1.0-alpha] - 2026-02-15

### Added
- Initial release — AI Agent Privacy Shield for Windows
- AI agent process detection via `tasklist /FO CSV` with pattern matching
- File monitoring via chokidar for sensitive directories (`.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure`, `.env*`)
- Handle-based file scanning via PowerShell for per-process file attribution
- Network monitoring via `Get-NetTCPConnection` with DNS reverse lookup
- Sensitive file classification against 70+ rules
- Per-agent risk scoring with time-decay model
- System tray with procedural shield icon and native notifications
- Dark mode dashboard with real-time agent monitoring
- Process control (Kill/Suspend/Resume per agent)
- Settings persistence via JSON in Electron userData directory
- Secure IPC bridge via contextBridge with context isolation
