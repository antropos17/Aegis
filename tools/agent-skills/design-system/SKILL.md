---
name: design-system
description: Apply the approved AEGIS Observatory design during interface work, or develop separate visual concepts when the user requests a redesign.
---

# AEGIS interface design

## Select the reference for this task

For implementation, locate frontend/observatory/DESIGN.md, reference/README.md and the preserved reference/ artwork in the selected checkout. Read the current entrypoint and stylesheet imports. If these files are absent, inspect git worktree list and the project handoff before choosing a source; do not silently switch to a historical temporary checkout.

DESIGN.md indexes the current contract and relevant dated amendments in DESIGN-HISTORY.md. Apply later decisions to the same property; the compact-density amendment supersedes the earlier panel inset. The approved Observatory reference is the integration baseline. Old Shield/Fancy mockups and historical plans do not override it. A running implementation is not proof of visual approval.

For an explicit redesign, logo/icon exploration or prototype request, follow the new brief and use the existing design as context. Alternative shapes, colors and layouts are allowed within that brief. Keep concept assets separate from application integration until the user requests that integration. Static concept work does not require running Electron or the full repository test suite.

## Implement and verify

When integrating real data, preserve the approved composition, stylesheet order, typography, spacing, artwork and controls except where the requested change calls for a revision. Use the selected implementation's semantic tokens; do not assume an older tokens.css or font list defines Observatory.

Preserve meaningful absence and stale states, stamped process identities, and pending/failure feedback. A disabled action explains the actual capability limit. Use original local artwork for existing third-party agent identities.

Visually check affected states against the applicable reference at matching viewport, theme and scale. For interface changes, cover the relevant light/dark, focus, selection and empty/error states; check reduced motion when motion changes. Select viewport and scale cases from the current design contract and affected workflow; distinguish the fixed application layout from supported OS/accessibility zoom.

Builds, type checks and layout assertions supplement rendered review. Report which states were actually checked and any remaining gaps; do not claim visual fidelity from a build alone.
