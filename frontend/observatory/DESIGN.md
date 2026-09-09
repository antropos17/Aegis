# AEGIS Observatory

The approved visual source is preserved in reference/ui/ and reference/DESIGN.md. Its full stylesheet set is imported in styles.ts. The earlier Shield/Fancy UI designs and the superseded integration layouts have no design authority.

Preserve the template's composition, hierarchy, spacing, typography, artwork, controls, radar and dialogs while connecting real telemetry through runtime/host.ts. Runtime behavior is implemented in Svelte; simulated observations must never enter a desktop build.

Live-data adaptations:
- The requested radar clarity pass replaces repeated side charts and long in-circle labels with compact numbered markers and one roster. Selected-agent details form a separate panel; process selection is expandable. The monitoring screen has separate summary cards and one activity chart; per-agent resource bars remain in Statistics. `styles/radar-clarity.css` records this intentional refinement after the preserved template cascade.
- Radar, agent tables and resource charts group processes by agent identity. Radar pages four groups at a time. Product rows open an overview; its process list and the radar instance selector open explicitly chosen stamped processes. Distance represents risk, as in the template.
- Group usage totals require every member to be measured; risk is the highest member score, Files counts distinct retained paths, and Network counts observed connections. Product grouping never supplies a process action identity.
- High contrast keeps the template's neutral surfaces and strengthens text, focus and interactive boundaries. The toolbar theme toggle returns to ordinary light/dark, matching the template; high contrast is selected explicitly in Settings.
- An unavailable measurement is shown as a dash. Sensor outages pause the sweep and disable process control.
- API configuration and analysis controls reflect supported host capabilities. A retained report is labeled with its actual evidence scope.
- Settings and policy drafts survive view navigation; failed saves retain inputs. Unsaved provider keys are cleared when their dialog or workspace closes.
- The toolbar pauses displayed telemetry while the monitoring backend continues. Process commands always validate the current live population.
- Process details show four recent events and link to the retained list. Technical evidence and resource delivery diagnostics remain available in expandable sections.

Visual verification uses the preserved source at the same viewport, scale, theme and state. Passing tests alone must not be reported as proof that the interface matches the template.
