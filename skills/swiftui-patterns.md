---
name: swiftui-patterns
description: "SwiftUI architecture, state management with @Observable, view composition, navigation, and performance optimization."
activation:
  - "The user explicitly asks to use swiftui-patterns."
  - "Building or reviewing user-facing interface behavior."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Task context matches: SwiftUI architecture, state management with @Observable, view composition, navigation, and performance optimization."
---

# Swiftui Patterns

## When to Activate
- The user explicitly asks to use swiftui-patterns.
- Building or reviewing user-facing interface behavior.
- Changing schemas, queries, persistence, or data access patterns.
- Task context matches: SwiftUI architecture, state management with @Observable, view composition, navigation, and performance optimization.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply swiftui-patterns to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Loading, empty, error, and responsive states are designed and verified.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
