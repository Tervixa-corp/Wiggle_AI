---
name: browser-qa
description: Verify localhost web endpoints with the gateway's readable-text browser inspection, which reports HTTP status, the page title and visible text but no DOM tree or console capture.
---

# Browser QA

The Browser pane can fetch an HTTP(S) URL and show its status, title and readable text. It does not render
the page, expose a DOM/accessibility tree, or stream console output. Do not claim to have inspected any of
those.

1. Use the Browser pane (or `curl -I` through `run_command` with the user's approval) to confirm the URL
   answers with the expected status.
2. Read the extracted text to check the page's visible copy and headings.
3. For UI logic, read the source files with `read_file`/`grep` and run the project's own tests. Those are the
   only reliable checks available here.
4. Report exactly which checks ran and which did not.
