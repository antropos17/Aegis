# Observatory

This is the Svelte integration of the approved Observatory template. Follow DESIGN.md and reference/README.md. The preserved template remains the visual authority; an implementation difference is not a new approval. New files use TypeScript without any. Use the complete original stylesheet order in styles.ts and preserve the template's markup hierarchy and local artwork. Additional host behavior uses scoped CSS.

Desktop and preview mount the same App.svelte. entry.ts uses the build-time preview constant; production must never import simulated telemetry. runtime/host.ts owns telemetry subscriptions, seed revision guards, freshness and disposal. Bind commands to the actual preload methods and require their documented success result.

Use stamped instanceId for observations and process actions. Durable project permission keys have different semantics. Retain last reliable populations during outages; never turn absent measurements into zero. Show attribution and source evidence as returned. Paths are metadata, not permission to read file contents.

Tests live under tests/renderer and frontend/observatory/tests. Run the repository checks plus both builds and frontend:test for visual changes. Electron smoke uses a disposable profile. Never run process interventions against user processes, or paid provider tests without explicit authorization.

The integration record and its remaining verification are in ../../OBSERVATORY-INTEGRATION.md. No release version or publication is implied by local packaging.
