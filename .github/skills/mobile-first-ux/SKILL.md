---
name: mobile-first-ux
description: "Design FleetProof mobile experiences for truck drivers on basic smartphones. Use for POD camera capture, trip actions, offline states, upload progress, and retakes."
---

# Mobile-First Driver UX

## When to use

- Designing or implementing a driver-facing page or interaction on a phone.
- Building POD photo capture, trip start/completion, upload, offline, retry, or retake flows.
- Reviewing a mobile layout for use in low-connectivity field conditions.

## Workflow

1. Inspect the current driver flow and the existing API contract before designing. Reuse available trip/session data; do not add redundant questions.
2. Define the shortest safe path from the driver's current task to completion, including failure, retry, and retake paths.
3. Prioritize a single large primary POD camera action. Keep supporting text short and instructions concrete.
4. Design and implement for narrow screens and touch first; check one-handed reach, device constraints, and slow or interrupted networks.
5. Provide clear, persistent feedback for capture, local pending state, upload progress, success, failure, retry, and retake.

## FleetProof-specific rules

- Use large touch targets, generous spacing, readable text, and a clear action hierarchy on basic smartphones.
- Minimize typing and avoid unnecessary forms. Prefer verified trip context from the existing backend.
- Use concise labels and purposeful icons with accompanying accessible names. Do not rely on icons or color alone.
- Make offline capture and pending upload unmistakable; distinguish saved-on-device, uploading, uploaded, and failed states accurately.
- Show upload/compression progress when available; explain a retryable failure and preserve the captured image when safe.
- Provide clear success, failure, and retake feedback. Do not report success until the existing API confirms it.
- Consider low literacy and optional Hindi/Marathi voice prompts when the feature supports them; avoid making voice the only instruction.
- Inspect the existing upload size/type requirements and API before changing capture or compression behavior.

## Common mistakes to avoid

- A desktop admin dashboard squeezed onto a phone.
- Tiny controls, dense tables, long instructions, keyboard-heavy workflows, or multiple competing primary actions.
- Silent offline queuing, ambiguous spinners, false success, lost captures on transient errors, or unclear retry controls.
- Invented routes, unsupported background sync assumptions, or collecting location/data without an explicit product requirement.

## FleetProof example

On a driver's assigned-trip screen, present the current trip and next action clearly. Once a POD is needed, make the camera action dominant, show the photo review/retake choice, and surface pending-upload status until the existing upload API confirms completion.
