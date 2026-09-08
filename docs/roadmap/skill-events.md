# Skill names in file events

Observed skill paths now carry optional `FileEvent.skill` metadata with `name`,
`rootPath` and `relativePath`. The name comes from the skill directory; no skill
contents, frontmatter, scripts or credentials are opened to classify the event.
An empty relative path denotes an observed skill root. Recognized shapes include
`skills/<name>`, `skills/.system/<name>/SKILL.md`, plugin-cache skill directories,
their resource files, and a custom directory containing an observed `SKILL.md`.
Windows, POSIX and UNC separators are supported.

The flat and grouped feeds display `Skill: testing · SKILL.md` or
`Skill: improve-animations` for a root event. They derive the same label from older
events' paths. The full original path remains the reveal/copy target and tooltip.
Directory-group `holding` observations retain their ordinary path label: they do
not identify a specific skill file. Audit history preserves the original path,
action and attribution; no historical records are rewritten.

Skill identity and actor attribution are separate. `Unknown source` means that no
agent was established for the event. Reading `.claude/skills/foo` alone cannot prove
that Claude performed the access. The new metadata never substitutes an agent,
changes attribution strength, clears sensitive classification or changes an action
such as `created` into `used`. Shared skill directories can be accessed by any tool.

This improves naming of observations already supplied by the file sensors. It does
not make chokidar observe reads, guarantee capture of transient open/read/close
operations, or prove that the agent followed a skill's instructions. PID-backed
handle observations retain their confirmed owner when available. Exact transient
read attribution remains part of the file-sensor roadmap.
