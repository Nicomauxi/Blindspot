---
name: api-design
description: "REST API design patterns including resource naming, status codes, pagination, filtering, error responses, versioning, and rate limiting for production APIs."
activation:
  - "The user explicitly asks to use api-design."
  - "Designing, integrating, or reviewing API contracts."
  - "Task context matches: REST API design patterns including resource naming, status codes, pagination, filtering, error responses, versioning, and rate limiting for production APIs."
---

# API Design Patterns

## When to Activate
- The user explicitly asks to use api-design.
- Designing, integrating, or reviewing API contracts.
- Task context matches: REST API design patterns including resource naming, status codes, pagination, filtering, error responses, versioning, and rate limiting for production APIs.

## Resource Design

### URL Structure

```http
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id
POST   /api/v1/orders/:id/cancel
```

### Naming Rules

- Use plural nouns, kebab-case, and no verbs in resource paths.
- Use query params for filtering, sorting, and search: `?status=active&sort=-created_at`.
- Use nested resources only for true ownership: `/users/:id/orders`.
- Model actions as state transitions first; use verb endpoints only when no resource representation fits.

## HTTP Status Codes

- `200 OK`: successful GET, PUT, PATCH.
- `201 Created`: successful POST, include `Location` when useful.
- `204 No Content`: successful DELETE or empty mutation response.
- `400 Bad Request`: malformed request or validation failure.
- `401 Unauthorized`: missing or invalid authentication.
- `403 Forbidden`: authenticated but not authorized.
- `404 Not Found`: missing resource or intentionally hidden resource.
- `409 Conflict`: version, uniqueness, or state conflict.
- `422 Unprocessable Entity`: syntactically valid JSON with invalid domain data.
- `429 Too Many Requests`: rate limit exceeded.
- `500 Internal Server Error`: unexpected server failure; never expose stack traces.

## Response Format

```json
{ "data": { "id": "user_123" } }
{ "data": [], "meta": { "total": 0, "page": 1, "per_page": 20 } }
{ "error": { "code": "validation_failed", "message": "Invalid input", "details": [] } }
```

## Pagination

- Offset pagination: simple for small datasets, e.g. `?page=2&per_page=20`; avoid for large mutable collections.
- Cursor pagination: preferred for large or changing datasets, e.g. `?cursor=<opaque>&limit=20`.
- Always define max page size, stable ordering, and next/previous cursor semantics.

## Checklist
- Activation matched the user task and no narrower skill should take precedence.
- Existing project conventions were inspected before proposing or changing implementation.
- Request/response schemas, status codes, pagination, errors, and auth are explicit.
- Edge cases and failure modes are covered.
- Verification steps are documented or executed.
- Plural resource names, no verbs in URLs unless modeling an action is unavoidable.
- Schema validation on all inputs.
- Standard error envelope across endpoints.
- Pagination on all list endpoints.
- Authentication and authorization checked separately.
- Rate limiting configured for public or costly endpoints.
- No internal details in error responses.
