---
name: token-budget-advisor
description: "Token budget management and cost optimization for LLM API usage."
activation:
  - "The user explicitly asks to use token-budget-advisor."
  - "Designing, integrating, or reviewing API contracts."
  - "Task context matches: Token budget management and cost optimization for LLM API usage."
---

# Token Budget Advisor

## When to Activate
- The user explicitly asks to use token-budget-advisor.
- Designing, integrating, or reviewing API contracts.
- Task context matches: Token budget management and cost optimization for LLM API usage.

## Core Guidance
- Design around resources, contracts, idempotency, and explicit failure modes before implementation.
- Use stable request/response envelopes, typed validation, pagination for lists, and appropriate status codes.
- Document auth, rate limits, versioning, and compatibility expectations.

## Patterns
- Design a paginated list endpoint.
- Review an error envelope.
- Add rate limits to a public endpoint.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Request/response schemas, status codes, pagination, errors, and auth are explicit.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
