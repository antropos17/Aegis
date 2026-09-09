# Integration validation

See ../../OBSERVATORY-INTEGRATION.md for current status and the complete migration matrix. The preparation-only validation is superseded.

Validated so far: production and preview builds; 132 browser view/viewport/theme/scale combinations; explicit unavailable desktop bridge; zero real bridge calls from preview; no preview identities in production JavaScript; isolated-profile Electron startup with reliable real process observations and all 11 workspaces; TypeScript and Svelte diagnostics.

Regression tests cover host ordering, teardown, outages, PID reuse, command failures, permissions, imports, audit ties, resource unknown/zero, attribution and key isolation. All ten local gates passed. The Windows installer built and the packaged executable passed the same isolated-profile smoke; details and remaining manual release checks are in the root integration document.

No paid provider request, published release, non-Windows runtime validation or destructive action on a user process has been performed. Original preparation hashes in SOURCE.json remain historical provenance.
