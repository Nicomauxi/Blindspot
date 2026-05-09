---
name: team-builder
description: "Interactive agent picker for composing and dispatching parallel agent teams."
activation:
  - "The user explicitly asks to use team-builder."
  - "Designing agent workflows, tools, loops, evals, or context retrieval."
  - "Task context matches: Interactive agent picker for composing and dispatching parallel agent teams."
---

# Team Builder

## When to Activate
- The user explicitly asks to use team-builder.
- Designing agent workflows, tools, loops, evals, or context retrieval.
- Task context matches: Interactive agent picker for composing and dispatching parallel agent teams.

## Core Guidance
- Start from the user workflow and current design system. Build the actual interactive surface, not explanatory scaffolding.
- Represent loading, empty, error, disabled, and success states explicitly.
- Use accessible controls, predictable layout constraints, and responsive behavior that prevents overlap or layout shift.

## Patterns
- Apply team-builder to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Loading, empty, error, and responsive states are designed and verified.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
