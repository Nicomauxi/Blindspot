---
name: nutrient-document-processing
description: "Process, convert, OCR, extract, redact, sign, and fill documents using document workflow APIs for PDFs, DOCX, XLSX, PPTX, HTML, and images."
activation:
  - "The user explicitly asks to use nutrient-document-processing."
  - "Designing, integrating, or reviewing API contracts."
  - "Task context matches: Process, convert, OCR, extract, redact, sign, and fill documents using document workflow APIs for PDFs, DOCX, XLSX, PPTX, HTML, and images."
---

# Nutrient Document Processing

## When to Activate
- The user explicitly asks to use nutrient-document-processing.
- Designing, integrating, or reviewing API contracts.
- Task context matches: Process, convert, OCR, extract, redact, sign, and fill documents using document workflow APIs for PDFs, DOCX, XLSX, PPTX, HTML, and images.

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
