---
name: perl-testing
description: "Perl testing with Test2::V0, Test::More, prove runner, mocking, Devel::Cover coverage, and TDD methodology."
activation:
  - "The user explicitly asks to use perl-testing."
  - "Writing, fixing, or reviewing tests, coverage, or test strategy."
  - "Task context matches: Perl testing with Test2::V0, Test::More, prove runner, mocking, Devel::Cover coverage, and TDD methodology."
---

# Perl Testing

## When to Activate
- The user explicitly asks to use perl-testing.
- Writing, fixing, or reviewing tests, coverage, or test strategy.
- Task context matches: Perl testing with Test2::V0, Test::More, prove runner, mocking, Devel::Cover coverage, and TDD methodology.

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
- Tests include the regression or acceptance behavior before implementation is declared complete.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
