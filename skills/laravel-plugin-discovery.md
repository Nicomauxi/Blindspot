---
name: laravel-plugin-discovery
description: "Discover and evaluate Laravel packages. Use when looking for plugins or checking package health and compatibility."
activation:
  - "The user explicitly asks to use laravel-plugin-discovery."
  - "Task context matches: Discover and evaluate Laravel packages. Use when looking for plugins or checking package health and compatibility."
---

# Laravel Plugin Discovery

## When to Activate
- The user explicitly asks to use laravel-plugin-discovery.
- Task context matches: Discover and evaluate Laravel packages. Use when looking for plugins or checking package health and compatibility.

## Core Guidance
- Define the task loop, available tools, context budget, stop conditions, and measurable success criteria.
- Use evals or replayable checks before broadening autonomy. Keep tool inputs narrow and observations structured.
- Route cheap/simple work to cheaper models or deterministic code; reserve expensive reasoning for ambiguous, high-impact decisions.

## Patterns
- Apply laravel-plugin-discovery to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
