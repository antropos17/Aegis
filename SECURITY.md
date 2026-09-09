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
- **Preload bridge:** All IPC passes through `contextBridge.exposeInMainWorld` with a defined, enumerated API surface (54 channels: 44 invoke + 10 push). No arbitrary IPC.
- **Content Security Policy:** `default-src 'self'` and `script-src 'self'`, with no `unsafe-eval` or external font loading. `style-src` permits `unsafe-inline` for application styles.
- **No remote content:** The app loads only local files. No external URLs in the renderer.
- **Output escaping:** Svelte escapes ordinary text interpolations. Generated HTML reports use explicit escaping; raw HTML insertion and new export paths require their own review.
- **Single-instance lock:** Prevents duplicate application instances. It does not replace IPC sender checks or protect against a compromised local account.
- **Application updates:** Windows installer metadata requires an Ed25519 signature from the bundled release public key. SHA-256 and byte length are checked after download and again after native installation confirmation. This authenticates release artifacts independently of Windows Authenticode. Update IPC rejects foreign senders and subframes and accepts no paths or URLs. See [update architecture](ARCHITECTURE.md#application-updates) for supported builds and limitations.

### Privacy Architecture

- **Local storage by default.** Settings, baselines and audit logs are stored locally. There is no telemetry, cloud sync, analytics or usage tracking. Optional external requests are described below.
- **AI analysis is opt-in.** An explicit analysis request sends activity metadata to Anthropic using the configured API key. Depending on the analysis, this includes agent/process names, PIDs, parent chains, sensitive file paths, event counts and network endpoints. Monitoring does not require this service; analysis is not sent in the background.
- **Update requests are opt-in.** Automatic checks/downloads default to off; manual actions contact public GitHub releases. These requests send no monitoring records, settings or API keys. Installation always requires native confirmation.
- **Audit records contain metadata.** File-monitoring records include paths, names and attribution evidence, not the contents of observed sensitive files. Token accounting separately reads local agent transcript JSONL to extract usage; that is distinct from the file-monitoring pipeline.
- **API-key storage is conditional.** Settings use Electron safeStorage when encryption is available. If it is unavailable or encryption fails, the current implementation saves the key in plaintext in the local settings JSON. The key is decrypted in memory for API requests.

### Known Limitations

- **Monitor-only:** AEGIS observes and does not enforce at the OS level. Permission states (allow/monitor/block) affect UI display and alerting. OS-level blocking by kernel driver is a deliberate non-goal.
- **Configuration exports omit the API key:** Export Config and the diagnostic ZIP remove the configured Anthropic key from their settings copy. Importing configuration without a key preserves the local key. Paths, endpoints and agent metadata remain sensitive.
- **Audit logs are plaintext:** JSONL files in `userData/audit-logs/` are unencrypted. They contain file paths and agent names but not file contents.
- **Process attribution:** chokidar file watchers cannot attribute events to specific processes. Handle-based scanning provides per-process attribution but runs on a timer, not in real-time.
- **No TLS inspection:** Network monitoring sees connection endpoints only and cannot inspect encrypted traffic. TLS interception is a deliberate non-goal, not a pending feature.

## Supported Versions

Only the latest release on the [GitHub Releases page](https://github.com/antropos17/Aegis/releases) is supported. AEGIS is alpha software: older releases receive no security fixes. Always run the latest release.

## Credit

We credit security researchers in release notes unless you prefer to remain anonymous. Responsible disclosure is appreciated and respected.
