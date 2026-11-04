---
name: design-system
description: "Create or evolve reusable FleetProof design tokens and UI patterns. Use when standardizing styles or building shared buttons, inputs, tables, cards, badges, or dialogs."
---

# Design System

## When to use

- Introducing or refining shared visual tokens or reusable UI components.
- A feature needs consistent buttons, inputs, tables, cards, badges, or dialogs.
- Reviewing duplicated styling or inconsistent component behavior.

## Procedure

1. Inspect `app/globals.css`, the root layout, existing styles, and components before proposing tokens or primitives.
2. Identify the smallest shared foundation that the feature actually needs. Keep driver and executive page layouts separate.
3. Define semantic tokens for color, typography, spacing, radii, borders, and shadows only where recurring use justifies them. Use the existing Tailwind CSS 4 and CSS variable setup rather than adding a second styling system.
4. Reuse existing components and libraries where available. If no component library exists, keep primitives small and local to the established project structure.
5. Check keyboard behavior, visible focus, disabled/loading states, contrast, and responsive use for interactive primitives.

## FleetProof design rules

- Make tokens purposeful and semantic (for example, surface, text, border, focus, and status roles), not one-off color names tied to a single screen.
- Keep the palette neutral and restrained. Give success, warning, error, and pending states consistent meaning, with labels in addition to color.
- Establish a readable type scale and spacing rhythm. Prefer existing Geist typography unless a deliberate, justified product-wide change is requested.
- Use borders and subtle elevation only to clarify grouping and hierarchy. Avoid accumulating shadows, radii, or overrides.
- Make shared controls work for both the driver's mobile capture flow and executive tools without forcing the same composition or sizing in every context.

## Good practices

- Search for a component or token before adding another one; consolidate only when it improves consistency without changing unrelated behavior.
- Keep component APIs small, typed, and accessible. Keep data fetching and business decisions outside presentational primitives.
- Document non-obvious token semantics where the repository convention warrants it, and remove redundant declarations when safely replacing them.
- Verify representative controls in both driver and billing contexts and at narrow and wide viewport sizes.

## Common mistakes to avoid

- Creating a large component library before repeated patterns exist.
- Adding a dependency for controls already supported by the project.
- Hard-coding slightly different values in each screen or building a token for a single incidental value.
- Styling status only by color, hiding focus rings, or treating disabled and loading as the same state.
- Rebuilding the starter styles wholesale when a targeted extension is sufficient.

## FleetProof example

If trip rows and billing queue rows both need a status badge, share the semantic status treatment and accessible labeling; keep the row layouts tailored to their separate workflows.
