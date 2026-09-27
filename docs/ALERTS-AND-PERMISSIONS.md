# Alerts, review and permissions

AEGIS observes file activity after the operating system reports it. A sensitive
observation is a reason to inspect evidence, not proof that a file was read or
that an agent was malicious. An open-handle `holding` event only means the process
held a handle at the scan tick.

## Alerts in the desktop

The system-tray notification is optional and controlled by **Settings →
Monitoring → Notifications**. AEGIS can group a scan batch into one native
notification and limits attempts to one every 30 seconds. Later native popups
may be throttled while their observations remain in the audit path. It labels
an inferred source as inferred and an unknown source as unknown. Failure or
lack of native notification support does not stop the file-event audit path;
successful return from the native
API does not prove the operating system displayed the notification.

The Observatory shows a bottom toast for new sensitive file observations delivered
to that renderer window. **Alerts** opens a review list of up to 100 received
observations, newest first. The initial retained snapshot enters the list without
a fresh toast. The list distinguishes confirmed, inferred and unverified source
labels, and **Open evidence** opens the captured event. When a confirmed event
uniquely matches a live process with a fresh OS identity witness, **Open process
controls** opens that process's existing manual controls; it does not issue a
control action. **Mark reviewed** only
changes this window's review state. Older list entries can be evicted, and a
restarted window does not replay earlier notifications. The audit log and its
own retention are separate from this display list.

## What a decision changes

Saved agent `allow`, `monitor` and `block` preferences do not enforce file or
network access. AEGIS does not move, isolate or restore files when an alert is
reviewed. The process controls can suspend, resume or stop a currently verified
process identity, but they are separate manual actions and cannot undo an access
already observed.

Opt-in [selected-action policies](ACTION-EXECUTION.md) enforce exact routed
launches. `ask` uses a fresh terminal confirmation for one bound attempt; `deny`
does not launch. The desktop alert list does not grant approval to that route.
Other agent actions and ordinary file or network activity are outside it.
