---
name: security-audit
description: Audit filesystem, shell execution, authentication, and network boundaries for vulnerabilities.
---

# Security Audit

1. Verify all workspace file reads/writes canonicalize paths and block `..` traversal and symlink escapes.
2. Ensure API keys and secrets remain server-side and never appear in `/api/status` or error messages.
3. Enforce explicit permission gates (`suggest`, `auto_edit`, `full_auto`) and safe shell allowlists.
