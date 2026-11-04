---
name: accessibility
description: "Apply accessible frontend design and implementation to FleetProof screens. Use for semantic HTML, keyboard support, focus, contrast, labels, dialogs, status feedback, and touch targets."
---

# Accessibility

## When to use

- Creating or reviewing any page, form, navigation, table, dialog, or interactive state.
- Adding keyboard interaction, validation messages, status updates, or responsive touch controls.
- Checking whether a screen can be understood without color, sight, precise pointer input, or audio.

## Implementation rules

- Use semantic HTML elements for headings, landmarks, navigation, forms, buttons, and tables. Preserve a logical heading hierarchy.
- Give each input a persistent programmatic label; associate help text and errors with the correct control.
- Ensure all functionality is keyboard-operable, with logical tab order and a clearly visible focus indicator.
- Maintain readable contrast for text, controls, boundaries, and focus states. Never rely on color alone to communicate status.
- Give icon-only buttons accessible names and decorative icons appropriate hidden treatment.
- Use native buttons for actions and links for navigation. Identify disabled, loading, invalid, and selected states programmatically.
- Announce important asynchronous feedback (such as POD upload success or failure) accessibly without moving focus unexpectedly.
- Make dialogs operable with keyboard and assistive technology: label the dialog, manage focus on open/close, and support expected dismissal behavior.
- Use adequately sized, spaced touch targets, especially for driver camera, retry, and retake actions.
- Respect reduced-motion preferences and do not use animation as the sole status signal.

## FleetProof checks

- A driver can find and activate the camera action using touch and keyboard, and can distinguish upload pending, complete, failed, and retake-required states without color alone.
- A billing executive can navigate filters and trip/review/billing tables without a mouse and identify row actions and headings.
- Charts have a concise text summary; tables have understandable headers and captions or equivalent labels.
- Validation and API errors are associated with the relevant form or action and provide a clear recovery path.

## Common mistakes to avoid

- Placeholder-only inputs, unlabeled icons, low-contrast helper text, removed outlines, or focus traps.
- Status conveyed only by red/green, icon shape, animation, or screen position.
- Clickable generic containers instead of semantic links/buttons.
- Dismissing an error before a screen reader can detect it or announcing every progress tick excessively.

## FleetProof example

When an upload fails, announce a concise error, keep the captured image available when safe, and expose a labeled retry action. Pair an error icon/color with explicit text such as “Upload failed — retry.”
