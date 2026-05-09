---
name: cost-aware-llm-pipeline
description: "Cost optimization for LLM API usage: model routing by task complexity, budget tracking, retry logic, and prompt caching."
activation:
  - "The user explicitly asks to use cost-aware-llm-pipeline."
  - "Designing, integrating, or reviewing API contracts."
  - "Task context matches: Cost optimization for LLM API usage: model routing by task complexity, budget tracking, retry logic, and prompt caching."
---

# Cost Aware LLM Pipeline

## When to Activate
- The user explicitly asks to use cost-aware-llm-pipeline.
- Designing, integrating, or reviewing API contracts.
- Task context matches: Cost optimization for LLM API usage: model routing by task complexity, budget tracking, retry logic, and prompt caching.

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
