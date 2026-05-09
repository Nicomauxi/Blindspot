---
name: clickhouse-io
description: "ClickHouse database patterns, query optimization, analytics, and data engineering best practices for high-performance analytical workloads."
activation:
  - "The user explicitly asks to use clickhouse-io."
  - "Changing schemas, queries, persistence, or data access patterns."
  - "Task context matches: ClickHouse database patterns, query optimization, analytics, and data engineering best practices for high-performance analytical workloads."
---

# Clickhouse Io

## When to Activate
- The user explicitly asks to use clickhouse-io.
- Changing schemas, queries, persistence, or data access patterns.
- Task context matches: ClickHouse database patterns, query optimization, analytics, and data engineering best practices for high-performance analytical workloads.

## Core Guidance
- Model data ownership, cardinality, lifecycle, and query paths before choosing schema shape.
- Add indexes for real access patterns, verify query plans for hot paths, and keep migrations reversible where possible.
- Separate persistence details from domain behavior and test both success and constraint failures.

## Patterns
- Apply clickhouse-io to a matching implementation, review, or planning task.
- Use alongside adjacent skills when the task crosses boundaries.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Migration path, rollback, indexes, and compatibility are accounted for.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
