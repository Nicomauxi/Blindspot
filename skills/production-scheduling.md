---
name: production-scheduling
description: "Production scheduling and capacity planning patterns."
activation:
  - "The user explicitly asks to use production-scheduling."
  - "Task context matches: Production scheduling and capacity planning patterns."
---

# Production Scheduling

## When to Activate
- The user explicitly asks to use production-scheduling.
- Task context matches: Production scheduling and capacity planning patterns.

## Core Guidance
- Make the delivery path repeatable: build, configure, verify, deploy, monitor, and roll back.
- Keep environment assumptions explicit and validate them before deployment.
- Use health checks, logs, metrics, and smoke tests to detect failure quickly.

## Patterns
- Apply production-scheduling to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
