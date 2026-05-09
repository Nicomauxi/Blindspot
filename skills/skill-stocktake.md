---
name: skill-stocktake
description: "Audit skills for quality. Quick scan changed skills or full stocktake with batch evaluation."
activation:
  - "The user explicitly asks to use skill-stocktake."
  - "Building or reviewing user-facing interface behavior."
  - "Task context matches: Audit skills for quality. Quick scan changed skills or full stocktake with batch evaluation."
---

# Skill Stocktake

## When to Activate
- The user explicitly asks to use skill-stocktake.
- Building or reviewing user-facing interface behavior.
- Task context matches: Audit skills for quality. Quick scan changed skills or full stocktake with batch evaluation.

## Core Guidance
- Start from the user workflow and current design system. Build the actual interactive surface, not explanatory scaffolding.
- Represent loading, empty, error, disabled, and success states explicitly.
- Use accessible controls, predictable layout constraints, and responsive behavior that prevents overlap or layout shift.

## Patterns
- Apply skill-stocktake to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Loading, empty, error, and responsive states are designed and verified.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
