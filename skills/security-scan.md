---
name: security-scan
description: "Scan AI assistant configuration for security vulnerabilities, misconfigurations, and injection risks. Checks settings, MCP servers, hooks, and agent definitions."
activation:
  - "The user explicitly asks to use security-scan."
  - "Assessing authentication, authorization, input handling, secrets, or supply-chain risk."
  - "Designing agent workflows, tools, loops, evals, or context retrieval."
  - "Task context matches: Scan AI assistant configuration for security vulnerabilities, misconfigurations, and injection risks. Checks settings, MCP servers, hooks, and agent definitions."
---

# Security Scan

## When to Activate
- The user explicitly asks to use security-scan.
- Assessing authentication, authorization, input handling, secrets, or supply-chain risk.
- Designing agent workflows, tools, loops, evals, or context retrieval.
- Task context matches: Scan AI assistant configuration for security vulnerabilities, misconfigurations, and injection risks. Checks settings, MCP servers, hooks, and agent definitions.

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
