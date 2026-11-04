---
name: dashboard-design
description: "Design FleetProof logistics, trip, review, and billing dashboards. Use for operations KPIs, filters, tables, queues, charts, and responsive executive workflows."
---

# Dashboard Design

## When to use

- Creating or improving billing-executive or operations dashboards.
- Designing trip management tables, missing-POD views, AI review queues, or billing queues.
- Choosing meaningful metrics, filters, charts, or responsive table alternatives.

## Workflow

1. Inspect existing pages, API routes, and response schemas before choosing metrics or data fields. Explain which existing files and APIs the feature will use.
2. Identify the executive's decision or task; prioritize the queue or action that enables it.
3. Choose only metrics that can be supported by real API data and that help users act. Avoid inferred or fabricated KPIs.
4. Lay out filters, summary metrics, and actionable detail in order of use; keep charting subordinate to operational decisions.
5. Design loading, empty, error, and partial-data states, plus responsive behavior for wide tables on smaller screens.

## FleetProof dashboard patterns

- **Operations overview:** show useful trip/POD performance and ageing only when supplied by the backend, with clear time scope and definitions.
- **Missing-POD dashboard:** make overdue or pending PODs identifiable and connect each row to a useful next action.
- **Trip management:** support scanning key trip details, status, and next action; keep filters relevant and state visible.
- **AI review queue:** distinguish items needing human review, communicate reason/status clearly, and provide a direct path to inspect the POD.
- **Billing queue:** make client and billing-cycle filters easy to see and understand; surface queue eligibility and export actions without implying unsupported rules.

## Rules

- Use clear metric labels, units, time periods, and comparison context. Do not use a KPI card when a plain label is clearer.
- Keep table columns purposeful, align numeric values, and make row actions predictable.
- Make filters visible, combinable where supported, and understandable in the URL or current view when the existing app pattern supports it.
- Use charts only when trends, comparisons, or composition are easier to understand visually than in a table; include text alternatives or accessible summaries.
- For narrow screens, use an intentional compact row/card treatment or horizontal scrolling with clear affordances; do not silently hide important data or actions.
- Provide empty states that explain why there is no data and what users can do, error states with recovery, and loading states that preserve layout.
- Use consistent labels and status meaning across trip, review, and billing areas.

## Common mistakes to avoid

- Dashboard wallpaper: arbitrary charts, redundant KPIs, decorative metrics, or dense grids with no decision value.
- Fake data, unsupported calculations, or treating missing values as zero.
- Filters that do not affect results, buttons without outcomes, or table actions that surprise users.
- Desktop-only tables that become unreadable or inaccessible on mobile.

## FleetProof example

For the billing queue, inspect the existing queue and export APIs first. Present supported client/cycle filters, real eligible trip groups, understandable empty/error feedback, and the actual export action; never fabricate a billing batch to fill the screen.
