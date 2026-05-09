---
name: agent-harness-construction
description: "Design and optimize AI agent action spaces, tool definitions, and observation formatting for higher completion rates."
activation:
  - "The user explicitly asks to use agent-harness-construction."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Designing agent workflows, tools, loops, evals, or context retrieval."
  - "Task context matches: Design and optimize AI agent action spaces, tool definitions, and observation formatting for higher completion rates."
---

# Agent Harness Construction

## When to Activate
- The user explicitly asks to use agent-harness-construction.
- Changing schemas, queries, persistence, or data access patterns.
- Designing agent workflows, tools, loops, evals, or context retrieval.
- Task context matches: Design and optimize AI agent action spaces, tool definitions, and observation formatting for higher completion rates.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply agent-harness-construction to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
