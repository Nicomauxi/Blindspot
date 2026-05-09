---
name: customs-trade-compliance
description: "Trade compliance patterns for customs, import/export regulations, and HS code classification."
activation:
  - "The user explicitly asks to use customs-trade-compliance."
  - "Task context matches: Trade compliance patterns for customs, import/export regulations, and HS code classification."
---

# Customs Trade Compliance

## When to Activate
- The user explicitly asks to use customs-trade-compliance.
- Task context matches: Trade compliance patterns for customs, import/export regulations, and HS code classification.

## Core Guidance
- Represent the operational workflow as states, owners, timestamps, exceptions, and evidence.
- Optimize for auditability: preserve source documents, decisions, escalation history, and SLA impact.
- Separate planning assumptions from actual events so variance can be measured and improved.

## Patterns
- Apply customs-trade-compliance to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
