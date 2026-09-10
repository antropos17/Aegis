# Risk clarity — 2026-09-10

This pass implements the requested clarity work after PR #414. It covers identifying an agent's worker processes, understanding the exposure score and reaching the process behind a group score.

## Behavior

Monitoring's previous average-risk card now opens the highest-risk agent's explanation. The radar inspector and agent table expose the leading scoring factor and a direct explanation link. Group and process detail windows have a Risk explanation tab, with a route from the group to its highest-scoring process; Back restores the explanation.

The factor list is produced by the same function used for the existing exposure score. File/network joins, weights, ceilings, rounding, saved false-positive adjustment and anomaly separation are unchanged. Each enriched process carries its factor breakdown and actual applied adjustment; a captured process explanation survives later telemetry changes. Group explanations use the current available population, including a preserved snapshot during outage. Missing process identity produces an explicit coverage limitation, and no name/PID fallback is introduced.

At the 900x600 minimum viewport with 150% scale, the leading factor is placed beside the score so it is visible without scrolling. Full factor details remain below. The twelve approved reference stylesheets and import order are preserved.

## Verification

3212 tests passed with 4 skips across 184 files; format, lint, TypeScript/Svelte, both builds and both mutation gates passed. Browser QA covered the previous 464 states plus 16 risk-clarity theme/scale/viewport states and the score-to-process-to-activity navigation contract. The final compact layout passed the focused 16-state browser recheck, including an assertion that the primary cause is visible without scrolling. Windows packaging passed all 11 workspaces, settings restart and six exports. Both packaged and installed-native checks passed group → exact process → captured explanation → activity → Back with no renderer errors. The native sampled launches showed zero contributing activity; nonzero factor explanations were verified with deterministic fixtures.

The verified package is installed at X:/Future/ESCAPE/AEGIS-Desktop. All 193 runtime files, including 114 renderer files, match the source/build. ASAR SHA256: 094bc0642dfb2ba38bd273220bbe0ed2b93abbb9654d51e9a7506100af63dd5c. The previous app is backed up at X:/Future/ESCAPE/AEGIS-Desktop-before-clarity-20260910; settings and Local Storage at X:/tmp/aegis-clarity-profile-backup-20260910. Settings bytes are unchanged after installed-profile verification.

Paid provider requests, process interventions, native macOS/Linux execution and prolonged runtime monitoring are outside this interface pass.
