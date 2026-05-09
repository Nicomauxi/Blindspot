---
name: videodb
description: "See, understand, and act on video and audio. Ingest, index, search moments, transcode, edit timelines, and generate media assets."
activation:
  - "The user explicitly asks to use videodb."
  - "Task context matches: See, understand, and act on video and audio. Ingest, index, search moments, transcode, edit timelines, and generate media assets."
---

# Videodb

## When to Activate
- The user explicitly asks to use videodb.
- Task context matches: See, understand, and act on video and audio. Ingest, index, search moments, transcode, edit timelines, and generate media assets.

## Core Guidance
- Use this skill when the task matches its focus: See, understand, and act on video and audio. Ingest, index, search moments, transcode, edit timelines, and generate media assets.
- Prefer existing project conventions and keep changes scoped to the requested behavior.
- Make interfaces explicit, handle failure paths, and verify the result with the cheapest reliable check.

## Patterns
- Apply videodb to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
