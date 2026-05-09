---
name: blueprint
description: "Project blueprint and scaffolding patterns."
activation:
  - "The user explicitly asks to use blueprint."
  - "Task context matches: Project blueprint and scaffolding patterns."
---

# Blueprint

## When to Activate
- The user explicitly asks to use blueprint.
- Task context matches: Project blueprint and scaffolding patterns.

## Core Guidance
- Use this skill when the task matches its focus: Project blueprint and scaffolding patterns.
- Prefer existing project conventions and keep changes scoped to the requested behavior.
- Make interfaces explicit, handle failure paths, and verify the result with the cheapest reliable check.

## Patterns
- Apply blueprint to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
