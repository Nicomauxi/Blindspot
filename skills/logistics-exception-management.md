---
name: logistics-exception-management
description: "Patterns for handling logistics exceptions: delays, damaged goods, routing errors, and carrier escalations."
activation:
  - "The user explicitly asks to use logistics-exception-management."
  - "Task context matches: Patterns for handling logistics exceptions: delays, damaged goods, routing errors, and carrier escalations."
---

# Logistics Exception Management

## When to Activate
- The user explicitly asks to use logistics-exception-management.
- Task context matches: Patterns for handling logistics exceptions: delays, damaged goods, routing errors, and carrier escalations.

## Core Guidance
- Represent the operational workflow as states, owners, timestamps, exceptions, and evidence.
- Optimize for auditability: preserve source documents, decisions, escalation history, and SLA impact.
- Separate planning assumptions from actual events so variance can be measured and improved.

## Patterns
- Apply logistics-exception-management to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
