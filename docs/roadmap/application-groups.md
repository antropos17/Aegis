# Application process grouping

Each detected process remains a separate record in the existing scan payload.
`process-utils.enrichWithParentChains()` adds optional `applicationGroup` metadata
using the same fresh process map that stamped its process identity:

```json
{
  "agent": "ChatGPT Desktop",
  "pid": 102,
  "instanceId": "102:1700000002000",
  "applicationGroup": {
    "id": "app:100:1700000000000",
    "rootPid": 100,
    "processCount": 6
  }
}
```

The group key identifies the highest observed ancestor detected as the same agent.
Intermediate unmatched processes may connect it; a different detected tool ends
the walk. Every edge requires fresh births with the parent no younger than its
child. A shared shell, directory or executable name alone cannot join launches.
The count includes the root and detected members only, not every unmatched helper.
Cycles and paths beyond the bounded ancestry walk have no group.

Metadata is absent for unobserved births, observation outages and pid-0 synthetics.
macOS currently has no birth provider and receives no inferred grouping. The UI
shows `?` when it cannot establish a complete application count. Existing
name-based cards still collect those rows, with individual PIDs available.

The current panel keeps one card per agent name. It shows application-instance and
process counts separately, with each multi-process tree behind a native disclosure
inside the expanded card. The header uses the same count. Risk, activity, CPU and
memory remain bound to the highest-risk representative or each individual PID;
they are not silently summed onto another process's score. Each action still targets
the selected PID. Group keys never replace process identities in sessions, audit
records, permissions, token accounting or event attribution.

These are observed process trees, not chat/window counts or durable application
sessions. An absent root leaves the surviving observed tree with a new presentation
key. Epoch-millisecond birth resolution retains the process identity's documented
ambiguity for collisions within one timestamp unit.

The separate frontend can read `DetectedAgent.applicationGroup` directly or reuse
`groupAgentsForPanel` / `groupApplicationInstances`. The latter groups current rows
and counts them rather than trusting a possibly filtered payload's cached total.
