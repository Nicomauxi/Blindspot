---
name: quality-nonconformance
description: "Quality management patterns for handling nonconformance reports, corrective actions, and root cause analysis."
activation:
  - "The user explicitly asks to use quality-nonconformance."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Task context matches: Quality management patterns for handling nonconformance reports, corrective actions, and root cause analysis."
---

# Quality Nonconformance

## When to Activate
- The user explicitly asks to use quality-nonconformance.
- Changing schemas, queries, persistence, or data access patterns.
- Task context matches: Quality management patterns for handling nonconformance reports, corrective actions, and root cause analysis.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply quality-nonconformance to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
