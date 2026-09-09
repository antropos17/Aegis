# AEGIS Observatory

The approved visual source is preserved in reference/ui/ and reference/DESIGN.md. Its full stylesheet set is imported in styles.ts. The earlier Shield/Fancy UI designs and the superseded integration layouts have no design authority.

Preserve the template's composition, hierarchy, spacing, typography, artwork, controls, radar and dialogs while connecting real telemetry through runtime/host.ts. Runtime behavior is implemented in Svelte; simulated observations must never enter a desktop build.

Live-data adaptations:
- Radar groups processes by agent identity and pages four groups at a time. A group opens an explicitly chosen stamped process; process counts and the instance selector make grouping visible. Distance represents risk, as in the template.
- An unavailable measurement is shown as a dash. Sensor outages pause the sweep and disable process control.
- API configuration and analysis controls reflect supported host capabilities. A retained report is labeled with its actual evidence scope.
- Settings and policy drafts survive view navigation; failed saves retain inputs. Unsaved provider keys are cleared when their dialog or workspace closes.
- The toolbar pauses displayed telemetry while the monitoring backend continues. Process commands always validate the current live population.
- Process details show four recent events and link to the retained list. Technical evidence and resource delivery diagnostics remain available in expandable sections.

Visual verification uses the preserved source at the same viewport, scale, theme and state. Passing tests alone must not be reported as proof that the interface matches the template.
