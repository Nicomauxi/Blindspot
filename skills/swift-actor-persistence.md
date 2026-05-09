---
name: swift-actor-persistence
description: "Thread-safe data persistence in Swift using actors: in-memory cache with file-backed storage, eliminating data races."
activation:
  - "The user explicitly asks to use swift-actor-persistence."
  - "Task context matches: Thread-safe data persistence in Swift using actors: in-memory cache with file-backed storage, eliminating data races."
---

# Swift Actor Persistence

## When to Activate
- The user explicitly asks to use swift-actor-persistence.
- Task context matches: Thread-safe data persistence in Swift using actors: in-memory cache with file-backed storage, eliminating data races.

## Core Guidance
- Use this skill when the task matches its focus: Thread-safe data persistence in Swift using actors: in-memory cache with file-backed storage, eliminating data races.
- Prefer existing project conventions and keep changes scoped to the requested behavior.
- Make interfaces explicit, handle failure paths, and verify the result with the cheapest reliable check.

## Patterns
- Apply swift-actor-persistence to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
