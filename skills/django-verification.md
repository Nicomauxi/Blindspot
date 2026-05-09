---
name: django-verification
description: "Verification loop for Django: migrations, linting, tests with coverage, security scans, and deployment readiness."
activation:
  - "The user explicitly asks to use django-verification."
  - "Writing, fixing, or reviewing tests, coverage, or test strategy."
  - "Assessing authentication, authorization, input handling, secrets, or supply-chain risk."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Task context matches: Verification loop for Django: migrations, linting, tests with coverage, security scans, and deployment readiness."
---

# Django Verification

## When to Activate
- The user explicitly asks to use django-verification.
- Writing, fixing, or reviewing tests, coverage, or test strategy.
- Assessing authentication, authorization, input handling, secrets, or supply-chain risk.
- Changing schemas, queries, persistence, or data access patterns.
- Task context matches: Verification loop for Django: migrations, linting, tests with coverage, security scans, and deployment readiness.

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
- Migration path, rollback, indexes, and compatibility are accounted for.
- Inputs, authz, secrets, logging, and dependency risks were reviewed.
- Tests include the regression or acceptance behavior before implementation is declared complete.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
