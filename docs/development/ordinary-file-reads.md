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
not dismissed by app shutdown.

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

Windows packaging needs the .NET 10 SDK and restore access. The default build hook
publishes a self-contained folder; end users need no separate runtime. See
[.NET deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/).
