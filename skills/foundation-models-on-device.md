---
name: foundation-models-on-device
description: "Apple FoundationModels framework for on-device LLM: text generation, guided generation, tool calling, and snapshot streaming in iOS 26+."
activation:
  - "The user explicitly asks to use foundation-models-on-device."
  - "Building or reviewing user-facing interface behavior."
  - "Task context matches: Apple FoundationModels framework for on-device LLM: text generation, guided generation, tool calling, and snapshot streaming in iOS 26+."
---

# Foundation Models On Device

## When to Activate
- The user explicitly asks to use foundation-models-on-device.
- Building or reviewing user-facing interface behavior.
- Task context matches: Apple FoundationModels framework for on-device LLM: text generation, guided generation, tool calling, and snapshot streaming in iOS 26+.

## Core Guidance
- Start from the user workflow and current design system. Build the actual interactive surface, not explanatory scaffolding.
- Represent loading, empty, error, disabled, and success states explicitly.
- Use accessible controls, predictable layout constraints, and responsive behavior that prevents overlap or layout shift.

## Patterns
- Apply foundation-models-on-device to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Loading, empty, error, and responsive states are designed and verified.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
