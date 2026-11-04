---
name: frontend-design
description: "Design or implement polished FleetProof frontend screens and flows. Use for visual hierarchy, layouts, interaction design, and UI quality before coding."
---

# Frontend Design

## When to use

- Creating or revising a frontend page, flow, component, or visual treatment.
- Reviewing whether a FleetProof screen feels coherent, purposeful, and production-ready.
- Use with `mobile-first-ux` for driver flows, `dashboard-design` for operations and billing screens, and `accessibility` for interaction requirements.

## Design workflow

1. Inspect the existing page, shared styles, components, and the relevant API before proposing a UI. State which existing files and API routes the feature will use.
2. Identify the user, their task, the key information they need, and the single most important action on the screen.
3. Sketch the hierarchy and responsive behavior before writing UI code. Keep driver and billing-executive layouts distinct while using shared design foundations.
4. Reuse existing patterns and components. Match the repository's existing Next.js, Tailwind CSS, and typography setup; do not assume a component or icon library exists.
5. Implement meaningful loading, empty, error, success, and disabled states as applicable. Validate the main task at mobile, tablet, and desktop widths.

## FleetProof design direction

FleetProof is a proof-of-delivery capture and billing platform for truck drivers using basic smartphones, billing executives on desktop, and operations teams monitoring trips. Aim for minimal, clean, premium enterprise SaaS: neutral surfaces, a restrained professional palette, readable typography, deliberate spacing, and clear information hierarchy.

- **Driver application:** mobile-first, minimal text, a prominent POD camera action, offline-aware feedback, and obvious capture/upload/retake outcomes.
- **Billing and operations:** desktop-first but responsive, optimized for scanning trip, review, and billing work.
- Share design tokens and recognizable components, not one forced layout. A driver capture flow should not resemble a shrunken admin dashboard.

## Rules

- Design the task flow and information hierarchy before coding; every visual element must serve a user task or communicate status.
- Use spacing, type scale, alignment, and restrained contrast to establish hierarchy. Keep related information grouped and actions predictable.
- Prefer neutral surfaces and a small, purposeful accent palette. Use status colors consistently and pair them with text or icons.
- Keep primary actions unmistakable and secondary actions visually quieter. Ensure every control has a real, defined behavior.
- Reuse existing components and styles; coordinate shared primitives with `design-system`.
- Respect backend contracts. Do not invent fields or use fake data to make a screen look complete.

## Common mistakes to avoid

- Generic dashboard templates, arbitrary charts, decorative KPI cards, or content unrelated to the user's task.
- Unnecessary gradients, glassmorphism, oversized shadows, excessive rounding, and decorative elements without purpose.
- Dense layouts, inconsistent alignment, ornamental uppercase labels, or multiple competing primary actions.
- Desktop layouts squeezed onto small screens or forms that ask users to re-enter data the backend already knows.

## FleetProof example

For a driver awaiting POD submission, prioritize the assigned trip context and one prominent camera action. For an executive reviewing a billing cycle, prioritize filters, queue status, actionable rows, and a clear route to inspect a POD; do not reuse the driver's full-screen capture layout.
