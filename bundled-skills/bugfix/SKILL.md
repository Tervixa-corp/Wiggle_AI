---
name: bugfix
description: Diagnose a failing test, crash or incorrect behaviour before changing code.
---

# Bugfix

1. Reproduce the failure with the narrowest command that shows it. Record the exact error.
2. Read the failing code and its callers before editing anything.
3. Form one hypothesis at a time and test it. Do not batch unrelated changes into a fix.
4. Fix the cause, not the symptom. If you suppress an error, say why in the summary.
5. Re-run the reproduction command and any related tests. Report the commands and their output.
6. If you could not reproduce the failure, say so plainly instead of guessing.
