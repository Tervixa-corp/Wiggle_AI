---
name: test-first
description: Write tests for behaviour before implementing or refactoring it.
---

# Test first

1. Identify the smallest observable behaviour to change.
2. Write a test that fails for the right reason, then run it and confirm it fails.
3. Implement the minimum change that makes it pass.
4. Run the full suite, not just the new test.
5. Cover the failure paths, not only the happy path: empty input, oversized input,
   malformed input, and the permission or error branch that guards the feature.
6. Never delete or weaken an existing assertion to make a change pass. If an
   existing test is genuinely wrong, explain why before changing it.
