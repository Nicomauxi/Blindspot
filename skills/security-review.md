---
name: security-review
description: "Comprehensive security checklist and patterns for authentication, user input handling, secrets management, API endpoints, and payment features."
activation:
  - "The user explicitly asks to use security-review."
  - "Assessing authentication, authorization, input handling, secrets, or supply-chain risk."
  - "Designing, integrating, or reviewing API contracts."
  - "Task context matches: Comprehensive security checklist and patterns for authentication, user input handling, secrets management, API endpoints, and payment features."
---

# Security Review

## When to Activate
- The user explicitly asks to use security-review.
- Assessing authentication, authorization, input handling, secrets, or supply-chain risk.
- Designing, integrating, or reviewing API contracts.
- Task context matches: Comprehensive security checklist and patterns for authentication, user input handling, secrets management, API endpoints, and payment features.

## Core Guidance
- Identify the trust boundaries first: caller identity, authorization decision, input origin, secret handling, and outbound effects.
- Prefer allow-lists, typed validation, parameterized APIs, least privilege, and fail-closed defaults.
- Treat logs, errors, redirects, uploads, and webhooks as security surfaces.

## Patterns
- Review a new login flow.
- Harden file upload handling.
- Audit secrets and environment configuration.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Request/response schemas, status codes, pagination, errors, and auth are explicit.
- Inputs, authz, secrets, logging, and dependency risks were reviewed.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
