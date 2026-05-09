---
name: strategic-compact
description: "Manual context compaction at logical intervals to preserve context through task phases."
activation:
  - "The user explicitly asks to use strategic-compact."
  - "Task context matches: Manual context compaction at logical intervals to preserve context through task phases."
---

# Strategic Compact

## When to Activate
- The user explicitly asks to use strategic-compact.
- Task context matches: Manual context compaction at logical intervals to preserve context through task phases.

## Core Guidance
- Use this skill when the task matches its focus: Manual context compaction at logical intervals to preserve context through task phases.
- Prefer existing project conventions and keep changes scoped to the requested behavior.
- Make interfaces explicit, handle failure paths, and verify the result with the cheapest reliable check.

## Patterns
- Apply strategic-compact to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
