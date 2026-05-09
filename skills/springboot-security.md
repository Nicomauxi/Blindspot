---
name: springboot-security
description: "Spring Security: authentication, authorization, validation, CSRF, secrets, headers, rate limiting, and dependency security."
activation:
  - "The user explicitly asks to use springboot-security."
  - "Assessing authentication, authorization, input handling, secrets, or supply-chain risk."
  - "Task context matches: Spring Security: authentication, authorization, validation, CSRF, secrets, headers, rate limiting, and dependency security."
---

# Springboot Security

## When to Activate
- The user explicitly asks to use springboot-security.
- Assessing authentication, authorization, input handling, secrets, or supply-chain risk.
- Task context matches: Spring Security: authentication, authorization, validation, CSRF, secrets, headers, rate limiting, and dependency security.

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
- Inputs, authz, secrets, logging, and dependency risks were reviewed.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
