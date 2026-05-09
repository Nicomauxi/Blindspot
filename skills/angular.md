---
name: angular
description: "Expert Angular TypeScript development with scalable, high-performance patterns."
activation:
  - "The user explicitly asks to use angular."
  - "Building or reviewing user-facing interface behavior."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Task context matches: Expert Angular TypeScript development with scalable, high-performance patterns."
---

# Angular

## When to Activate
- The user explicitly asks to use angular.
- Building or reviewing user-facing interface behavior.
- Changing schemas, queries, persistence, or data access patterns.
- Task context matches: Expert Angular TypeScript development with scalable, high-performance patterns.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply angular to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
