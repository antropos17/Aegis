# Ordinary Windows file reads

Windows x64 packages include the experimental ETW file-read helper. Open **Events**,
enter an existing local subdirectory in **Folder to monitor**, and choose **Start
file read monitoring**. Approve Windows consent. Capture stays off until this
explicit request; no diagnostic package marker or launch flag is needed.

Choose a narrow folder that you intend to observe. Whole drives, UNC paths,
missing folders and reparse-root aliases are refused before launch. The scope
check is lexical and launch-time; candidate file paths can still involve aliases.
The path is not persisted as a preference. Starting another capture clears the
previous displayed observations.

**Stop file read monitoring**, pausing monitoring, suspend and quit request cleanup.
Resume and unpause require another explicit Start and consent. Cancelling consent
or an occupied ETW session produces a failed capture; review Statistics sensor
health. If cleanup remains unverified, the runtime blocks a new capture. Do not
treat an unverified stop as session absence. A pending Windows consent window is
not dismissed by app shutdown. Emergency cleanup can require additional Windows
consent; enabling ordinary capture does not qualify every recovery path.

The ordinary capture continues beyond the diagnostic profile's one-minute limit.
Native queues, identity pins and the main/renderer observation rings remain
bounded. Kernel events/buffers lost, collector records dropped, mapping resets and
view omissions have separate counters. A zero kernel-loss count does not establish
loss-free capture. **Read observed** and **Potential sensitive
read** describe a kernel read candidate and enabled path rules. Contents and
malicious intent are not inspected. Agent labels require an event-time thread
witness, full process birth match and reliable population. Reads can remain
unverified, particularly for short-lived or newly created workers.

These observations remain separate from scored FileEvents, audit history,
baselines and sequence rules. Packaging this helper does not establish protected
installation, release provenance, every recovery scenario or complete capture.
Other platforms remain outside this feature.

The [genuine-agent runner](agent-sensitive-read.md#run) supports `--ordinary` and
separate first/persistent reads. Qualification must bind a clean source revision,
an unmarked normal package, its complete manifest and actual installed-agent
receipts. Modeled tests alone do not establish this result.

The [idle first-read qualification](../recon/evidence/agent-idle-first-read.json)
passes three installed Claude Code journeys after 65, 70 and 85 seconds in a clean
ordinary package. Each used one genuine Read of a new synthetic `.env`, without
README warmup, and showed the exact issuing agent, action and potential risk.
The native original-handle interval exceeded thirty seconds in each case,
qualifying continuous renewal rather than a fresh replacement. Privacy, normal
quit, native stop acknowledgement and independent session absence also passed.

The [earlier ordinary-package record](../recon/evidence/ordinary-agent-sensitive-read.json)
retains its persistent-read/explicit Stop PASS and separate first-read FAIL.
Its unique failure cause was not recoverable from that receipt. A native
regression independently proved that reopening live handles during renewal could
exclude already queued reads; renewal now keeps the original handles after fresh
identity checks. Four instrumented baseline journeys passed, so they do not
reproduce the historical intermittent failure. Nonzero collector drops and mapping
resets remain in the new evidence; no every-read or every-worker guarantee follows.

Windows packaging needs the .NET 10 SDK and restore access. The default build hook
publishes a self-contained folder; end users need no separate runtime. See
[.NET deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/).
