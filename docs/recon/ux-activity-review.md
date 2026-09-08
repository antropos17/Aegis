# Shield and Activity UX review — 2026-09-08

Scope: a focused pass over event viewing, filters, keyboard interaction and layout.
The user explicitly requested this UI work after the separate ETW harness work.

| Observed problem | Result |
| --- | --- |
| Activity waited for a file event indefinitely after a quiet scan; Network was behind the same loading gate. | A completed scan or available network data ends loading. Network opens independently. |
| Shield's grouping control did not change its feed; restrictive filters had no reset action. | Shield switches between flat and grouped feeds. Reset clears the three filters and preserves grouping. Empty history and no matching results have different messages. |
| Follow scrolled to the bottom although events are newest first. | Jump to latest returns to the top. New records preserve the position while reading older activity. |
| The fixed risk card intercepted Shield filter clicks at 1100 px; the feed could collapse vertically. | A compact risk summary sits in the navigation layout. Shield preserves feed height and scrolls when needed. |
| Filter states lacked accessibility state, and select typeahead triggered app shortcuts. | Controls expose pressed state, the agent selector has a visible label, focus is visible, and select input is excluded from single-key app shortcuts. |

Touched filter, view-switch and risk-summary surfaces use theme-aware colors.
This is not a complete contrast, screen-reader or application-wide accessibility audit.

## Verification

- Seven regression tests in [ActivityUX.test.js](../../tests/renderer/components/ActivityUX.test.js)
  cover loading, network independence, grouping, resetting, empty states and scroll behavior.
- Local full coverage run: 2901 tests passed, four skipped. After the final layout
  adjustments, 25 focused tests passed; renderer build, format, lint and both type
  checks passed. Lint reported no errors and retained its existing warnings.
- Built demo Chromium checks passed at 1440 × 900 and 1100 × 900 in dark mode,
  and 1440 × 900 in light mode. Pointer grouping, keyboard reset, select typeahead,
  filter overflow and risk/content overlap checks passed with no page errors.
  Shield's feed viewport measured 205 px and 131 px at the two widths.
- The running repository Electron window was refreshed with Ctrl+R. The compact
  summary and new filter controls rendered with live monitoring data while the
  main process remained running. The installed application was not updated.

Browser checks used demo fixtures rather than live monitoring. The unbuilt Vite
development preview hit an existing CommonJS `buildInstanceKey` export error, so
visual checks used `build:demo` and Vite preview. Live ETW collection, completeness
and attribution are outside this review.
