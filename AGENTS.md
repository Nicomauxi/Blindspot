# Agent Skill Library

This repository contains a Codex-oriented recreation of the supplied reusable skill library. Skills are reference documents injected into the working context when the user explicitly requests them or when task context clearly matches their activation rules.

## Invocation Rules

- Explicit invocation: when the user says "use the <skill-name> skill", open `skills/<skill-name>.md` and apply it for that turn.
- Automatic invocation: if the task matches a skill's `activation` frontmatter or `When to Activate` section, read the most specific matching skill before planning or editing.
- Multi-skill tasks: combine complementary skills when boundaries cross, such as `api-design` plus `security-review`, or `tdd-workflow` plus a framework-specific testing skill.
- Specificity: prefer framework/domain-specific skills over generic ones, then use generic skills as a backstop.
- Portability: this library intentionally omits source-system skills that are specific to Claude Code or Claude-only command workflows.

## How to Use a Skill

1. Read the skill file frontmatter and `When to Activate` section.
2. Follow the `Core Guidance` and `Checklist` while inspecting, planning, editing, reviewing, or verifying.
3. Keep project conventions above generic advice when they conflict.
4. Mention applied skills in handoff notes when they materially affected the work.

## Retained Skills

- [agent-harness-construction](skills/agent-harness-construction.md) - Design and optimize AI agent action spaces, tool definitions, and observation formatting for higher completion rates.
- [agentic-engineering](skills/agentic-engineering.md) - Operate as an agentic engineer using eval-first execution, decomposition, and cost-aware model routing.
- [ai-first-engineering](skills/ai-first-engineering.md) - Engineering operating model for teams where AI agents generate a large share of implementation output.
- [ai-regression-testing](skills/ai-regression-testing.md) - Regression testing strategies for AI-assisted development, sandbox-mode API testing, automated bug-check workflows, and patterns to catch AI blind spots where the same model writes and reviews code.
- [android-clean-architecture](skills/android-clean-architecture.md) - Clean Architecture patterns for Android and Kotlin Multiplatform projects: module structure, dependency rules, UseCases, Repositories, and data layer patterns.
- [angular](skills/angular.md) - Expert Angular TypeScript development with scalable, high-performance patterns.
- [angular-dev](skills/angular-dev.md) - Angular development assistant for modifying, optimizing, and building components, services, and modules following project conventions.
- [angular-testing](skills/angular-testing.md) - Write unit and integration tests for Angular v20+ using Vitest or Jasmine with TestBed and modern testing patterns.
- [angular-ui-patterns](skills/angular-ui-patterns.md) - Modern Angular UI patterns for loading states, error handling, and data display.
- [api-design](skills/api-design.md) - REST API design patterns including resource naming, status codes, pagination, filtering, error responses, versioning, and rate limiting for production APIs.
- [article-writing](skills/article-writing.md) - Write articles, guides, blog posts, tutorials, newsletter issues, and long-form content in a consistent voice.
- [autonomous-loops](skills/autonomous-loops.md) - Patterns and architectures for autonomous agent loops, from simple sequential pipelines to RFC-driven multi-agent DAG systems.
- [backend-patterns](skills/backend-patterns.md) - Backend architecture patterns, API design, database optimization, and server-side best practices for Node.js, Express, and Next.js API routes.
- [blueprint](skills/blueprint.md) - Project blueprint and scaffolding patterns.
- [carrier-relationship-management](skills/carrier-relationship-management.md) - Logistics carrier relationship management patterns.
- [caveman](skills/caveman.md) - Minimal, primitive-first implementation patterns. Strip everything back to fundamentals.
- [clickhouse-io](skills/clickhouse-io.md) - ClickHouse database patterns, query optimization, analytics, and data engineering best practices for high-performance analytical workloads.
- [code-review-and-quality](skills/code-review-and-quality.md) - Multi-axis code review across correctness, security, performance, and maintainability. Use before merging any change.
- [coding-standards](skills/coding-standards.md) - Universal coding standards for TypeScript, JavaScript, React, and Node.js.
- [compose-multiplatform-patterns](skills/compose-multiplatform-patterns.md) - Compose Multiplatform and Jetpack Compose patterns for KMP: state management, navigation, theming, and platform-specific UI.
- [content-engine](skills/content-engine.md) - Create platform-native content for X, LinkedIn, TikTok, YouTube, newsletters, and multi-platform campaigns.
- [content-hash-cache-pattern](skills/content-hash-cache-pattern.md) - Cache expensive file processing results using SHA-256 content hashes: path-independent, auto-invalidating, with service layer separation.
- [continuous-agent-loop](skills/continuous-agent-loop.md) - Patterns for continuous autonomous agent loops with quality gates, evals, and recovery controls.
- [continuous-learning](skills/continuous-learning.md) - Extract reusable patterns from sessions and save them as learned skills for future use.
- [cost-aware-llm-pipeline](skills/cost-aware-llm-pipeline.md) - Cost optimization for LLM API usage: model routing by task complexity, budget tracking, retry logic, and prompt caching.
- [cpp-coding-standards](skills/cpp-coding-standards.md) - C++ coding standards based on the C++ Core Guidelines. Use when writing, reviewing, or refactoring C++.
- [cpp-testing](skills/cpp-testing.md) - C++ testing with GoogleTest/CTest, sanitizers, and coverage.
- [crosspost](skills/crosspost.md) - Multi-platform content distribution across X, LinkedIn, Threads, and Bluesky. Adapts content per platform; never posts identical content cross-platform.
- [customs-trade-compliance](skills/customs-trade-compliance.md) - Trade compliance patterns for customs, import/export regulations, and HS code classification.
- [database-migrations](skills/database-migrations.md) - Database migration best practices for schema changes, rollbacks, and zero-downtime deployments across PostgreSQL, MySQL, Prisma, Drizzle, Django, TypeORM, and golang-migrate.
- [data-scraper-agent](skills/data-scraper-agent.md) - Build automated AI-powered data collection agents for public sources. Scrape on schedule, enrich with LLM, store in Notion/Sheets/Supabase, run on GitHub Actions.
- [deep-research](skills/deep-research.md) - Multi-source deep research using web search. Searches, synthesizes findings, and delivers cited reports.
- [deployment-patterns](skills/deployment-patterns.md) - Deployment workflows, CI/CD pipelines, Docker containerization, health checks, rollback strategies, and production readiness checklists.
- [django-patterns](skills/django-patterns.md) - Django architecture patterns, REST API design with DRF, ORM best practices, caching, signals, and middleware.
- [django-security](skills/django-security.md) - Django security: authentication, authorization, CSRF, SQL injection prevention, XSS prevention, and secure deployment.
- [django-tdd](skills/django-tdd.md) - Django testing with pytest-django, factory_boy, mocking, coverage, and testing DRF APIs.
- [django-verification](skills/django-verification.md) - Verification loop for Django: migrations, linting, tests with coverage, security scans, and deployment readiness.
- [dmux-workflows](skills/dmux-workflows.md) - Multi-agent orchestration using tmux pane manager. Patterns for parallel agent workflows across coding harnesses.
- [docker-patterns](skills/docker-patterns.md) - Docker and Docker Compose patterns for local development, container security, networking, volumes, and multi-service orchestration.
- [e2e-testing](skills/e2e-testing.md) - Playwright E2E testing patterns, Page Object Model, CI/CD integration, artifact management, and flaky test strategies.
- [energy-procurement](skills/energy-procurement.md) - Energy procurement and utility management patterns.
- [enterprise-agent-ops](skills/enterprise-agent-ops.md) - Operate long-lived agent workloads with observability, security boundaries, and lifecycle management.
- [eval-harness](skills/eval-harness.md) - Formal evaluation framework implementing eval-driven development principles.
- [exa-search](skills/exa-search.md) - Neural search patterns for web, code, and company research: web search, code examples, company intel, people lookup, and AI-powered deep research.
- [fal-ai-media](skills/fal-ai-media.md) - Unified media generation patterns: image, video, and audio; text-to-image, text/image-to-video, text-to-speech, and video-to-audio.
- [find-skills](skills/find-skills.md) - Helps discover and install agent skills when users ask how to do something or ask for a skill.
- [foundation-models-on-device](skills/foundation-models-on-device.md) - Apple FoundationModels framework for on-device LLM: text generation, guided generation, tool calling, and snapshot streaming in iOS 26+.
- [frontend-patterns](skills/frontend-patterns.md) - React, Next.js, state management, performance optimization, and UI best practices.
- [frontend-slides](skills/frontend-slides.md) - Create animation-rich HTML presentations or convert PowerPoint files to web. Helps non-designers discover visual direction through exploration.
- [golang-patterns](skills/golang-patterns.md) - Idiomatic Go patterns, best practices, and conventions for robust, efficient Go applications.
- [golang-testing](skills/golang-testing.md) - Go testing: table-driven tests, subtests, benchmarks, fuzzing, and test coverage. TDD methodology with idiomatic Go.
- [inventory-demand-planning](skills/inventory-demand-planning.md) - Inventory optimization and demand forecasting patterns.
- [investor-materials](skills/investor-materials.md) - Create pitch decks, one-pagers, investor memos, financial models, and fundraising materials with internal consistency across assets.
- [investor-outreach](skills/investor-outreach.md) - Draft cold emails, warm intro blurbs, follow-ups, and investor communications for fundraising.
- [iterative-retrieval](skills/iterative-retrieval.md) - Pattern for progressively refining context retrieval to solve the subagent context problem.
- [java-coding-standards](skills/java-coding-standards.md) - Java coding standards for Spring Boot: naming, immutability, Optional usage, streams, exceptions, generics, and project layout.
- [java-dev](skills/java-dev.md) - Java development assistant for modifying, optimizing, and building code following project conventions, design patterns, and naming standards.
- [javascript-dev](skills/javascript-dev.md) - JavaScript ES6+ development assistant for functions, modules, classes, and features. Applies modern JS best practices, functional patterns, and async handling.
- [jpa-patterns](skills/jpa-patterns.md) - JPA/Hibernate patterns for entity design, relationships, query optimization, transactions, auditing, indexing, pagination, and pooling in Spring Boot.
- [kotlin-coroutines-flows](skills/kotlin-coroutines-flows.md) - Kotlin Coroutines and Flow for Android and KMP: structured concurrency, Flow operators, StateFlow, error handling, and testing.
- [kotlin-exposed-patterns](skills/kotlin-exposed-patterns.md) - JetBrains Exposed ORM patterns: DSL queries, DAO pattern, transactions, HikariCP, Flyway migrations, and repository pattern.
- [kotlin-ktor-patterns](skills/kotlin-ktor-patterns.md) - Ktor server patterns: routing DSL, plugins, authentication, Koin DI, kotlinx.serialization, WebSockets, and testApplication testing.
- [kotlin-patterns](skills/kotlin-patterns.md) - Idiomatic Kotlin patterns for coroutines, null safety, and DSL builders.
- [kotlin-testing](skills/kotlin-testing.md) - Kotlin testing with Kotest, MockK, coroutine testing, property-based testing, and Kover coverage.
- [laravel-patterns](skills/laravel-patterns.md) - Laravel architecture, routing, Eloquent ORM, service layers, queues, events, caching, and API resources.
- [laravel-plugin-discovery](skills/laravel-plugin-discovery.md) - Discover and evaluate Laravel packages. Use when looking for plugins or checking package health and compatibility.
- [laravel-security](skills/laravel-security.md) - Laravel security for authentication, authorization, validation, CSRF, mass assignment, file uploads, secrets, and rate limiting.
- [laravel-tdd](skills/laravel-tdd.md) - TDD for Laravel with PHPUnit and Pest, factories, database testing, fakes, and coverage targets.
- [laravel-verification](skills/laravel-verification.md) - Verification loop for Laravel: env checks, linting, static analysis, tests with coverage, security scans, and deployment readiness.
- [liquid-glass-design](skills/liquid-glass-design.md) - iOS 26 Liquid Glass design system: dynamic glass material with blur, reflection, and interactive morphing for SwiftUI, UIKit, and WidgetKit.
- [logistics-exception-management](skills/logistics-exception-management.md) - Patterns for handling logistics exceptions: delays, damaged goods, routing errors, and carrier escalations.
- [market-research](skills/market-research.md) - Market research, competitive analysis, investor due diligence, and industry intelligence with source attribution and decision-oriented summaries.
- [mcp-server-patterns](skills/mcp-server-patterns.md) - Build MCP servers with Node/TypeScript SDK: tools, resources, prompts, Zod validation, stdio vs Streamable HTTP.
- [nutrient-document-processing](skills/nutrient-document-processing.md) - Process, convert, OCR, extract, redact, sign, and fill documents using document workflow APIs for PDFs, DOCX, XLSX, PPTX, HTML, and images.
- [perl-patterns](skills/perl-patterns.md) - Modern Perl 5.36+ idioms, best practices, and conventions for robust, maintainable Perl applications.
- [perl-security](skills/perl-security.md) - Comprehensive Perl security: taint mode, input validation, safe process execution, DBI parameterized queries, web security, and perlcritic policies.
- [perl-testing](skills/perl-testing.md) - Perl testing with Test2::V0, Test::More, prove runner, mocking, Devel::Cover coverage, and TDD methodology.
- [plankton-code-quality](skills/plankton-code-quality.md) - Write-time code quality enforcement via auto-formatting, linting, and agent-assisted fixes on every file edit.
- [postgres-patterns](skills/postgres-patterns.md) - PostgreSQL patterns for query optimization, schema design, indexing, and security.
- [production-scheduling](skills/production-scheduling.md) - Production scheduling and capacity planning patterns.
- [python-patterns](skills/python-patterns.md) - Pythonic idioms, PEP 8, type hints, and best practices for robust, efficient Python applications.
- [python-testing](skills/python-testing.md) - Python testing with pytest, TDD methodology, fixtures, mocking, parametrization, and coverage requirements.
- [quality-nonconformance](skills/quality-nonconformance.md) - Quality management patterns for handling nonconformance reports, corrective actions, and root cause analysis.
- [ralphinho-rfc-pipeline](skills/ralphinho-rfc-pipeline.md) - RFC-driven multi-agent DAG execution with quality gates, merge queues, and work unit orchestration.
- [regex-vs-llm-structured-text](skills/regex-vs-llm-structured-text.md) - Decision framework for choosing regex vs LLM when parsing structured text. Start with regex; add LLM only for low-confidence edge cases.
- [returns-reverse-logistics](skills/returns-reverse-logistics.md) - Returns processing and reverse logistics patterns.
- [rust-patterns](skills/rust-patterns.md) - Idiomatic Rust: ownership, error handling, traits, concurrency, and best practices for safe, performant applications.
- [rust-testing](skills/rust-testing.md) - Rust testing: unit tests, integration tests, async testing, property-based testing, mocking, and coverage. TDD methodology.
- [search-first](skills/search-first.md) - Research-before-coding workflow. Search for existing tools, libraries, and patterns before writing custom code.
- [security-review](skills/security-review.md) - Comprehensive security checklist and patterns for authentication, user input handling, secrets management, API endpoints, and payment features.
- [security-scan](skills/security-scan.md) - Scan AI assistant configuration for security vulnerabilities, misconfigurations, and injection risks. Checks settings, MCP servers, hooks, and agent definitions.
- [skill-stocktake](skills/skill-stocktake.md) - Audit skills for quality. Quick scan changed skills or full stocktake with batch evaluation.
- [springboot-patterns](skills/springboot-patterns.md) - Spring Boot architecture, REST API design, layered services, data access, caching, async processing, and logging.
- [springboot-security](skills/springboot-security.md) - Spring Security: authentication, authorization, validation, CSRF, secrets, headers, rate limiting, and dependency security.
- [springboot-tdd](skills/springboot-tdd.md) - TDD for Spring Boot with JUnit 5, Mockito, MockMvc, Testcontainers, and JaCoCo.
- [springboot-verification](skills/springboot-verification.md) - Verification loop for Spring Boot: build, static analysis, tests with coverage, security scans, and diff review.
- [strategic-compact](skills/strategic-compact.md) - Manual context compaction at logical intervals to preserve context through task phases.
- [swift-actor-persistence](skills/swift-actor-persistence.md) - Thread-safe data persistence in Swift using actors: in-memory cache with file-backed storage, eliminating data races.
- [swift-concurrency-6-2](skills/swift-concurrency-6-2.md) - Swift 6.2 Approachable Concurrency: single-threaded by default, @concurrent for explicit background offloading, isolated conformances.
- [swift-protocol-di-testing](skills/swift-protocol-di-testing.md) - Protocol-based dependency injection for testable Swift code: mock file system, network, and external APIs using focused protocols.
- [swiftui-patterns](skills/swiftui-patterns.md) - SwiftUI architecture, state management with @Observable, view composition, navigation, and performance optimization.
- [tdd-workflow](skills/tdd-workflow.md) - Enforces TDD with 80%+ coverage including unit, integration, and E2E tests. Use when writing new features, fixing bugs, or refactoring.
- [team-builder](skills/team-builder.md) - Interactive agent picker for composing and dispatching parallel agent teams.
- [token-budget-advisor](skills/token-budget-advisor.md) - Token budget management and cost optimization for LLM API usage.
- [ui-ux-pro-max](skills/ui-ux-pro-max.md) - UI/UX design intelligence for web and mobile: styles, color palettes, font pairings, UX guidelines, chart types, and framework-specific patterns.
- [verification-loop](skills/verification-loop.md) - Comprehensive verification system: run builds, tests, linters, security scans, and coverage checks before declaring work complete.
- [videodb](skills/videodb.md) - See, understand, and act on video and audio. Ingest, index, search moments, transcode, edit timelines, and generate media assets.
- [video-editing](skills/video-editing.md) - AI-assisted video editing: cutting, structuring, augmenting footage with FFmpeg, Remotion, TTS, media generation, and editor workflows.
- [visa-doc-translate](skills/visa-doc-translate.md) - Translate visa application documents from images to English and create a bilingual PDF.
- [x-api](skills/x-api.md) - X/Twitter API integration: posting tweets and threads, reading timelines, search, and analytics. Covers OAuth, rate limits, and platform-native posting.

## Excluded Source Skills

- claude-api: Claude API specific.
- claude-devfleet: Claude Code/DevFleet specific.
- configure-ecc: Source-system installer specific.
- nanoclaw-repl: Claude command-line REPL specific.
