---
name: verification-loop
description: "Comprehensive verification system: run builds, tests, linters, security scans, and coverage checks before declaring work complete."
activation:
  - "The user explicitly asks to use verification-loop."
  - "Writing, fixing, or reviewing tests, coverage, or test strategy."
  - "Assessing authentication, authorization, input handling, secrets, or supply-chain risk."
  - "Building or reviewing user-facing interface behavior."
  - "Task context matches: Comprehensive verification system: run builds, tests, linters, security scans, and coverage checks before declaring work complete."
---

# Verification Loop

## When to Activate
- The user explicitly asks to use verification-loop.
- Writing, fixing, or reviewing tests, coverage, or test strategy.
- Assessing authentication, authorization, input handling, secrets, or supply-chain risk.
- Building or reviewing user-facing interface behavior.
- Task context matches: Comprehensive verification system: run builds, tests, linters, security scans, and coverage checks before declaring work complete.

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
- Loading, empty, error, and responsive states are designed and verified.
- Inputs, authz, secrets, logging, and dependency risks were reviewed.
- Tests include the regression or acceptance behavior before implementation is declared complete.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
