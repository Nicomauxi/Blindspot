---
name: ai-regression-testing
description: "Regression testing strategies for AI-assisted development, sandbox-mode API testing, automated bug-check workflows, and patterns to catch AI blind spots where the same model writes and reviews code."
activation:
  - "The user explicitly asks to use ai-regression-testing."
  - "Writing, fixing, or reviewing tests, coverage, or test strategy."
  - "Designing, integrating, or reviewing API contracts."
  - "Task context matches: Regression testing strategies for AI-assisted development, sandbox-mode API testing, automated bug-check workflows, and patterns to catch AI blind spots where the same model writes and reviews code."
---

# Ai Regression Testing

## When to Activate
- The user explicitly asks to use ai-regression-testing.
- Writing, fixing, or reviewing tests, coverage, or test strategy.
- Designing, integrating, or reviewing API contracts.
- Task context matches: Regression testing strategies for AI-assisted development, sandbox-mode API testing, automated bug-check workflows, and patterns to catch AI blind spots where the same model writes and reviews code.

## Core Guidance
- Start with the behavior under test, write or update the failing test first when practical, and cover the smallest public surface that proves the change.
- Use focused fixtures and deterministic data. Avoid brittle assertions on incidental implementation details.
- Include negative paths, edge cases, and regression cases for any bug being fixed.

## Patterns
- Red-green-refactor for a new behavior.
- Regression test for a reported bug.
- Coverage review before merge.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Request/response schemas, status codes, pagination, errors, and auth are explicit.
- Tests include the regression or acceptance behavior before implementation is declared complete.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
