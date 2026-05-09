---
name: rust-patterns
description: "Idiomatic Rust: ownership, error handling, traits, concurrency, and best practices for safe, performant applications."
activation:
  - "The user explicitly asks to use rust-patterns."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Task context matches: Idiomatic Rust: ownership, error handling, traits, concurrency, and best practices for safe, performant applications."
---

# Rust Patterns

## When to Activate
- The user explicitly asks to use rust-patterns.
- Changing schemas, queries, persistence, or data access patterns.
- Task context matches: Idiomatic Rust: ownership, error handling, traits, concurrency, and best practices for safe, performant applications.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply rust-patterns to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
