---
name: regex-vs-llm-structured-text
description: "Decision framework for choosing regex vs LLM when parsing structured text. Start with regex; add LLM only for low-confidence edge cases."
activation:
  - "The user explicitly asks to use regex-vs-llm-structured-text."
  - "Task context matches: Decision framework for choosing regex vs LLM when parsing structured text. Start with regex; add LLM only for low-confidence edge cases."
---

# Regex Vs LLM Structured Text

## When to Activate
- The user explicitly asks to use regex-vs-llm-structured-text.
- Task context matches: Decision framework for choosing regex vs LLM when parsing structured text. Start with regex; add LLM only for low-confidence edge cases.

## Core Guidance
- Define the task loop, available tools, context budget, stop conditions, and measurable success criteria.
- Use evals or replayable checks before broadening autonomy. Keep tool inputs narrow and observations structured.
- Route cheap/simple work to cheaper models or deterministic code; reserve expensive reasoning for ambiguous, high-impact decisions.

## Patterns
- Apply regex-vs-llm-structured-text to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
