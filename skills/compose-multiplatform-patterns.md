---
name: compose-multiplatform-patterns
description: "Compose Multiplatform and Jetpack Compose patterns for KMP: state management, navigation, theming, and platform-specific UI."
activation:
  - "The user explicitly asks to use compose-multiplatform-patterns."
  - "Building or reviewing user-facing interface behavior."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Task context matches: Compose Multiplatform and Jetpack Compose patterns for KMP: state management, navigation, theming, and platform-specific UI."
---

# Compose Multiplatform Patterns

## When to Activate
- The user explicitly asks to use compose-multiplatform-patterns.
- Building or reviewing user-facing interface behavior.
- Changing schemas, queries, persistence, or data access patterns.
- Task context matches: Compose Multiplatform and Jetpack Compose patterns for KMP: state management, navigation, theming, and platform-specific UI.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply compose-multiplatform-patterns to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Loading, empty, error, and responsive states are designed and verified.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
