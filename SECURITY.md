# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AEGIS, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### Contact

Email: **[SECURITY_EMAIL_PLACEHOLDER]**

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 7 days
- **Fix or mitigation:** Best effort within 30 days, depending on severity

### What Qualifies

- Remote code execution via IPC or renderer
- Credential exposure through the audit log or export features
- Bypass of content security policy
- Privilege escalation via the preload bridge
- Injection attacks through user-controlled input (agent names, file paths)

### What Does NOT Qualify

- Issues requiring physical access to the machine
- Denial of service against the local Electron app
- Vulnerabilities in Electron itself (report to Electron project)
- Social engineering attacks

## Security Architecture

AEGIS follows Electron security best practices:

- **Context isolation:** Enabled. Renderer cannot access Node.js APIs directly.
- **Node integration:** Disabled in renderer.
- **Preload bridge:** All IPC goes through `contextBridge.exposeInMainWorld` with a defined API surface.
- **Content Security Policy:** `default-src 'self'` with limited exceptions for fonts.
- **No remote content:** The app loads only local files. No external URLs in the renderer.
- **Input sanitization:** All user-visible strings pass through `escapeHtml()` before DOM insertion.

### Known Limitations

- **Monitor-only:** AEGIS currently observes but does not enforce/block at the OS level. Permission states affect UI display only. True enforcement requires kernel-level hooks (planned for future).
- **Audit logs are plaintext:** Log files in `userData/audit-logs/` are unencrypted JSON. They contain file paths and agent names but not file contents.
- **API key storage:** The Anthropic API key is stored in `settings.json` in Electron's userData directory. It is not encrypted at rest.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Responsible Disclosure

We ask that you:
1. Give us reasonable time to fix the issue before public disclosure
2. Do not access or modify other users' data
3. Do not degrade the service for other users
4. Act in good faith

We will credit reporters in the release notes (unless you prefer anonymity).
