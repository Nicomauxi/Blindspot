---
name: plankton-code-quality
description: "Write-time code quality enforcement via auto-formatting, linting, and agent-assisted fixes on every file edit."
activation:
  - "The user explicitly asks to use plankton-code-quality."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Designing agent workflows, tools, loops, evals, or context retrieval."
  - "Task context matches: Write-time code quality enforcement via auto-formatting, linting, and agent-assisted fixes on every file edit."
---

# Plankton Code Quality

## When to Activate
- The user explicitly asks to use plankton-code-quality.
- Changing schemas, queries, persistence, or data access patterns.
- Designing agent workflows, tools, loops, evals, or context retrieval.
- Task context matches: Write-time code quality enforcement via auto-formatting, linting, and agent-assisted fixes on every file edit.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply plankton-code-quality to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
