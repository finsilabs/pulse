# Security

PULSE is read-only on ad platforms. Google has no read-only OAuth scope; use a read-only Google Ads account role as defense in depth. Source request contracts and offline tests enforce the narrower implementation.

Treat account metrics as private. A remote operator can decrypt grants with its host key. Self-host only where you trust the operator, TLS termination, disk backups and secret management. One process owns each state file; horizontal multi-writer deployment is not supported.

Do not put tokens, real account snapshots or private customer information in public issues. Report security vulnerabilities through the GitHub repository's private vulnerability-reporting feature when enabled, or contact the maintainers privately before disclosing details. If no private channel is available, open a minimal issue asking for one without exploit details or secret data.

Before activating a deployment, verify your OAuth redirect URIs, platform app approval/access level, public HTTPS origin and storage permissions. Offline tests do not establish that a third-party OAuth app has been approved or that native clients have been verified.
