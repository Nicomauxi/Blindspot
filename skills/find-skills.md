---
name: find-skills
description: "Helps discover and install agent skills when users ask how to do something or ask for a skill."
activation:
  - "The user explicitly asks to use find-skills."
  - "Designing agent workflows, tools, loops, evals, or context retrieval."
  - "Task context matches: Helps discover and install agent skills when users ask how to do something or ask for a skill."
---

# Find Skills

## When to Activate
- The user explicitly asks to use find-skills.
- Designing agent workflows, tools, loops, evals, or context retrieval.
- Task context matches: Helps discover and install agent skills when users ask how to do something or ask for a skill.

## Core Guidance
- Define the task loop, available tools, context budget, stop conditions, and measurable success criteria.
- Use evals or replayable checks before broadening autonomy. Keep tool inputs narrow and observations structured.
- Route cheap/simple work to cheaper models or deterministic code; reserve expensive reasoning for ambiguous, high-impact decisions.

## Patterns
- Apply find-skills to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
