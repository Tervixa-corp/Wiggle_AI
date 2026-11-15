---
name: security-review
description: Review code for path traversal, injection, secret exposure and unsafe defaults.
---

# Security review

Check each of these explicitly and report only what you actually verified:

- Paths: is every user- or model-supplied path resolved against a fixed root, with
  traversal and symlink escapes rejected?
- Secrets: can any API key, token or credential reach the browser, logs, error
  messages, or a third-party response body?
- Processes: is shell execution gated by an explicit approval, and are destructive
  patterns screened independently of that approval?
- Network: are outbound URLs validated, and can a request cause a credential to be
  sent to an unexpected host?
- Input: is untrusted text (file contents, tool output, web pages) kept out of the
  instruction channel?
- Defaults: is the safe option the default, and does every failure path fail closed?

State clearly which items you could not verify.
