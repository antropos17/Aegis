# GitHub presentation and link audit

Audit date: 2026-09-19. This records a documentation and repository-presentation
review, not a security certification or a new installer release.

## Scope and method

The local-link pass covered 140 Markdown, text and template documents, including
15 root documents and seven GitHub templates/support files. It checked 371 local
or repository `master` link occurrences against case-sensitive tracked paths and
Markdown/HTML anchors. No broken local target was found in that baseline.

The external pass collected 1,023 distinct HTTP(S) addresses from 133 tracked
Markdown/text documents, excluding code examples, local hosts and repository
file links covered by the local pass. Requests used five concurrent workers and
a 12-second timeout. HEAD failures were checked with GET, GitHub's authenticated
API or the original publisher where possible. A successful response proves the
target was reachable at audit time; it does not prove every sentence on that
page remains current. No exhaustive review of every historical issue or PR
discussion is claimed.

## Corrections

| Surface | Result |
| --- | --- |
| [Project overview](../README.md) | Added task-oriented entry points, a dated simulated interface preview and a documentation index. Clarified source-tree versus installed-release behavior. |
| [Documentation index](README.md) | Grouped desktop guides, opt-in action contracts, evidence and contributor references. |
| Download information | Corrected the latest published prerelease to `aegis-v0.15.0-alpha`, published 2026-09-12. The download badge targets the releases list because the repository publishes alpha prereleases. |
| [Release verification](RELEASE-VERIFICATION.md) | Scoped signed-manifest instructions to releases from `0.13.0-alpha`; removed an unverifiable claim about all private-key copies. |
| [Changelog](../CHANGELOG.md) | Repaired the comparison from `v0.3.0-alpha` to `aegis-v0.3.1-alpha`; the older tag has no `aegis-` prefix. Verified the corrected comparison through the GitHub API. |
| Platform claims | Documented Linux generation-witness conditions and token-collection prerequisites; native Linux token collection remains unverified. |
| [Security description](../SECURITY.md) | Disclosed automatic DNS lookups, user-opened guide links and the boundaries of opt-in direct-child execution. Reporting policy and exclusions were preserved. |
| [Contribution guide](../CONTRIBUTING.md) and GitHub templates | Updated verification instructions, release/source context in bug reports and feature-request areas for local review, action controls and MCP. |
| [Machine-readable overview](../llms.txt) and package description | Included the current review and action-tool surfaces without promising attribution for every observed event. |

The accompanying repository About update uses the same capability summary,
points the homepage to the documentation index and adds discovery topics for
MCP, local-first operation and Svelte. Repository metadata is separate from this
file and must be checked through GitHub after applying the update.

## Link results and limits

Of the 1,023 external addresses, 1,021 were verified or corrected. The initial
request failures included transient GitHub errors and a NuGet HEAD response that
returned 404 even though GET and the official package index confirmed the package.
Those links were retained after checking the targets.

The two GNU Bash manual links in [shell redirections](SHELL-REDIRECTIONS.md)
could not be fetched reliably from the audit environment. Official indexed
content corroborated the pages, but their live responses remain unverified.
They were retained rather than replaced with an unverified alternative.

Private security-report forms, contribution prompts and simulated preview data
were inspected without submitting reports, modifying user data or publishing a
release. See the separate [UI/UX audit](OBSERVATORY-UX-AUDIT.md) for interface
changes and validation.
