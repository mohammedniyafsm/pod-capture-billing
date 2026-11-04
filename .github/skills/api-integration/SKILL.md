---
name: api-integration
description: "Integrate FleetProof frontend screens with the existing backend. Use for API calls, authentication, driver/billing roles, request schemas, and loading or error handling."
---

# API Integration

## When to use

- Connecting a frontend page, form, action, or data view to FleetProof backend functionality.
- Handling login/session state, driver or billing-executive access, POD uploads, trip actions, review, dashboard data, or billing exports.
- Investigating an API contract before building a frontend workflow.

## Required workflow

1. Inspect the relevant `app/api/**/route.ts` implementation, related validation/business logic, and existing frontend API helpers before writing integration code.
2. Confirm the HTTP method, path, authentication/role requirements, request schema, response shape, status codes, and side effects from source code. Treat README examples as clues to verify, not authoritative replacements.
3. Explain which existing frontend files and API routes will be used before implementing the feature.
4. Reuse existing authentication/session behavior and API client/helpers. Do not add a competing client, session mechanism, or endpoint.
5. Keep network calls, response parsing, and mutation state separate from presentational components according to existing project patterns.
6. Represent loading, success, empty, validation, authorization, network, and server-error outcomes accurately. Preserve user input or captures when safely retryable.
7. Validate the integration against the actual route behavior and avoid changing backend code unless explicitly requested.

## FleetProof rules

- Do not invent endpoints, response fields, database models, roles, transitions, or business rules. Read the route and related code.
- Reuse the existing authentication. Respect driver ownership and billing-executive role checks enforced by the backend; do not treat hidden UI as authorization.
- Follow backend validation, lifecycle, upload, review, and billing semantics rather than duplicating business rules in the browser.
- Do not replace real API calls with mock or placeholder data when real backend data is available.
- Do not report an action as successful until its real API response confirms success.
- Surface actionable errors and avoid broad catches, silent fallbacks, and success-shaped defaults.
- Keep presentation components independent of transport details; share typed request/response helpers only where an established pattern supports them.

## FleetProof examples

For an executive dashboard, verify the `GET /api/dashboard` route and its returned metrics before selecting cards. For billing, inspect the billing queue and export routes and their schemas. For driver capture, verify the authenticated trip/POD routes and the upload-link path separately; do not assume they have identical authorization or request contracts.

## Common mistakes to avoid

- Guessing endpoint paths, payloads, response fields, or status transitions from UI copy alone.
- Adding fake success, seeded frontend records, or stale static data over a working API.
- Treating client-side role checks as security or reimplementing server validation in presentation code.
- Discarding useful server error details, swallowing failures, or allowing duplicate submissions without considering route behavior.
