---
name: crosspost
description: "Multi-platform content distribution across X, LinkedIn, Threads, and Bluesky. Adapts content per platform; never posts identical content cross-platform."
activation:
  - "The user explicitly asks to use crosspost."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Task context matches: Multi-platform content distribution across X, LinkedIn, Threads, and Bluesky. Adapts content per platform; never posts identical content cross-platform."
---

# Crosspost

## When to Activate
- The user explicitly asks to use crosspost.
- Changing schemas, queries, persistence, or data access patterns.
- Task context matches: Multi-platform content distribution across X, LinkedIn, Threads, and Bluesky. Adapts content per platform; never posts identical content cross-platform.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply crosspost to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
