# Security Policy

AEGIS monitors AI agents — security is our core mission. We take vulnerabilities in AEGIS itself seriously, because a compromised monitoring tool is worse than no monitoring at all.

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

### Contact

Use [Report a vulnerability](https://github.com/antropos17/Aegis/security/advisories/new) to send a private report through GitHub. Do not include vulnerability details or credentials in public issues.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)
- Your preferred attribution (name, handle, or anonymous)

### Responsible Disclosure — 90-Day Policy

We follow a 90-day responsible disclosure timeline:

1. **You report** the vulnerability via GitHub Security Advisories
2. **We acknowledge** within 48 hours
3. **We assess** severity and impact within 7 days
4. **We develop and release** a fix within 90 days
5. **You may disclose** publicly after 90 days or after the fix is released, whichever comes first

For critical vulnerabilities (RCE, credential exposure), we aim for faster turnaround.

### What to Report

**Detection bypasses:**
- Methods for AI agents to evade AEGIS process detection
- File access that isn't captured by the monitoring system
- Network connections that escape scanning
- Techniques to tamper with audit logs

**Data leaks:**
- Credential exposure through audit logs, export files, or IPC channels
- Sensitive data persisted in unexpected locations
- API key leakage in logs or error messages

**IPC vulnerabilities:**
- Unauthorized access to IPC handlers from untrusted renderer content
- Bypasses of the contextBridge security boundary
- Injection attacks through agent names, file paths, or user input
- Privilege escalation via the preload bridge

**Application security:**
- Remote code execution via any vector
- Content Security Policy bypasses
- Cross-site scripting through rendered content
- Path traversal in file operations

### Out of Scope

- Social engineering attacks against AEGIS users
- Denial of service against the local Electron application
- Vulnerabilities in Electron or Chromium themselves (report to those projects)
- Issues requiring physical access to an unlocked machine
- Attacks requiring the user to install a malicious Electron app alongside AEGIS

## Security Architecture

AEGIS follows Electron security best practices:

- **Context isolation:** Enabled. The renderer process cannot access Node.js APIs.
- **Node integration:** Disabled in the renderer.
- **Preload bridge:** All IPC passes through `contextBridge.exposeInMainWorld` with a defined, enumerated API surface (56 channels: 45 invoke + 11 push). No arbitrary IPC.
- **Content Security Policy:** `default-src 'self'` and `script-src 'self'`, with no `unsafe-eval` or external font loading. `style-src` permits `unsafe-inline` for application styles.
- **Local desktop content:** The desktop loads local application files. Explicit documentation links open in the system browser; remote pages are not loaded inside the desktop renderer. Interface icons are bundled locally.
- **Output escaping:** Svelte escapes ordinary text interpolations. Generated HTML reports use explicit escaping; raw HTML insertion and new export paths require their own review.
- **Single-instance lock:** Prevents duplicate application instances. It does not replace IPC sender checks or protect against a compromised local account.
- **Local security review:** Native dialogs select inputs and new output files. The review channel validates the owned top-level document, invalidates results on navigation and retains reports in main. Exports contain the redacted report; snapshot acceptance requires a fresh matching capture. Canonical path and file-identity checks reduce filesystem races but do not form an OS sandbox. See [the UI guide](docs/LOCAL-SECURITY-UI.md).
- **Application updates:** Windows installer metadata requires an Ed25519 signature from the bundled release public key. SHA-256 and byte length are checked after download and again after native installation confirmation. This authenticates release artifacts independently of Windows Authenticode. Update IPC rejects foreign senders and subframes and accepts no paths or URLs. See [update architecture](ARCHITECTURE.md#application-updates) for supported builds and limitations.

### Privacy Architecture

- **Local storage by default.** Settings, baselines and audit logs are stored locally. There is no usage telemetry, cloud sync or analytics. Network requests are described below.
- **Endpoint naming uses DNS.** Network monitoring automatically queries the configured DNS resolver for reverse names of observed IP addresses and forward confirmation of those names. These queries expose the IP addresses and queried hostnames to the resolver, not monitored file contents.
- **Documentation links are user-opened.** Opening a guide sends the browser to its public GitHub page. Monitoring does not require opening these links.
- **AI analysis is opt-in.** An owned top-level renderer request requires a Cancel-default native confirmation before activity metadata is sent to Anthropic using the configured API key. Depending on the analysis, this includes agent/process names, PIDs, parent chains, sensitive file paths, event counts and network endpoints. Monitoring does not require this service; analysis is not sent in the background. The dialog states fixed data categories and destination, not the actual values.
- **Update requests are opt-in.** Automatic checks/downloads default to off; manual actions contact public GitHub releases. These requests send no monitoring records, settings or API keys. Installation always requires native confirmation.
- **Audit records contain metadata.** File-monitoring records include paths, names and attribution evidence, not the contents of observed sensitive files. Token accounting separately reads local agent transcript JSONL to extract usage; that is distinct from the file-monitoring pipeline.
- **API-key storage is conditional.** New Anthropic keys require Electron safeStorage with a secure OS backend; an unavailable backend rejects the save. An older plaintext key is activated only after an encrypted settings write succeeds. If migration cannot complete, the key stays inactive and its original file remains for explicit recovery or removal. Unrelated settings writes retry migration when secure storage recovers; otherwise they fail until the operator removes or replaces the key in AI analysis settings. The old plaintext file remains readable to processes with the user's file access until migration or removal succeeds.

### Known Limitations

- **Default monitoring:** Agent permission states (allow/monitor/block) affect UI display and alerting. They do not enforce OS-level blocking; a kernel blocking driver is a deliberate non-goal.
- **Opt-in selected-action execution:** Explicit CLI and MCP routes can gate an AEGIS-owned child on an exact policy decision, with a fresh terminal confirmation on confirmation routes. The separate Windows Job CLI route controls the lifetime of ordinary member descendants only when its cleanup receipt confirms it. An allowed process retains the caller's file and network privileges; this is not filesystem or network isolation. Exact terminal previews can expose arguments and environment secrets in scrollback. See [execution](docs/ACTION-EXECUTION.md) and [terminal confirmation](docs/ACTION-CONFIRMATION.md) for the distinct authorization contracts.
- **Configuration exports omit the API key:** Export Config and the diagnostic ZIP remove the configured Anthropic key from their settings copy. Importing configuration without a key preserves the local key. Paths, endpoints and agent metadata remain sensitive.
- **Audit logs are plaintext:** JSONL files in `userData/audit-logs/` are unencrypted. They contain file paths and agent names but not file contents.
- **Process attribution:** chokidar file watchers cannot attribute events to specific processes. Handle-based scanning provides per-process attribution but runs on a timer, not in real-time.
- **No TLS inspection:** Network monitoring sees connection endpoints only and cannot inspect encrypted traffic. TLS interception is a deliberate non-goal, not a pending feature.

## Supported Versions

Only the latest release on the [GitHub Releases page](https://github.com/antropos17/Aegis/releases) is supported. AEGIS is alpha software: older releases receive no security fixes. Always run the latest release.

## Credit

We credit security researchers in release notes unless you prefer to remain anonymous. Responsible disclosure is appreciated and respected.
