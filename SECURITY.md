# Security Policy

AEGIS monitors AI agents — security is our core mission. We take vulnerabilities in AEGIS itself seriously, because a compromised monitoring tool is worse than no monitoring at all.

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

### Contact

Email: **security@aegis-shield.dev**

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)
- Your preferred attribution (name, handle, or anonymous)

### Responsible Disclosure — 90-Day Policy

We follow a 90-day responsible disclosure timeline:

1. **You report** the vulnerability via email
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
- **Preload bridge:** All IPC passes through `contextBridge.exposeInMainWorld` with a defined, enumerated API surface (20+ channels). No arbitrary IPC.
- **Content Security Policy:** `default-src 'self'` with limited exceptions for Google Fonts.
- **No remote content:** The app loads only local files. No external URLs in the renderer.
- **Input sanitization:** All user-visible strings pass through `escapeHtml()` before DOM insertion. Template literals are used for HTML generation, not `innerHTML` with raw strings.
- **Single-instance lock:** Only one AEGIS instance runs at a time, preventing IPC interception.

### Privacy Architecture

- **All data stays local.** No telemetry, no cloud sync, no analytics, no tracking.
- **AI analysis is opt-in.** API calls to Anthropic only happen when the user explicitly clicks "Run AI Threat Analysis." No background API calls.
- **Audit logs contain metadata, not content.** File paths and agent names are logged, but file contents are never read or stored.
- **API key is stored locally** in `settings.json` in Electron's userData directory. It is not encrypted at rest — this is a known limitation.

### Known Limitations

- **Monitor-only:** AEGIS currently observes but does not enforce at the OS level. Permission states (allow/monitor/block) affect UI display and alerting. True OS-level enforcement via kernel hooks is planned.
- **Audit logs are plaintext:** JSONL files in `userData/audit-logs/` are unencrypted. They contain file paths and agent names but not file contents.
- **Process attribution:** chokidar file watchers cannot attribute events to specific processes. Handle-based scanning provides per-process attribution but runs on a timer, not in real-time.
- **No TLS inspection:** Network monitoring sees connection endpoints but cannot inspect encrypted traffic. Deep packet inspection is planned for future versions.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Current release — actively supported |

## Credit

We credit security researchers in release notes unless you prefer to remain anonymous. Responsible disclosure is appreciated and respected.
