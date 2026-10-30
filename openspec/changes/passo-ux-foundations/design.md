## Context

The existing Next.js app mounts four views inside a global swipe pager. Several independent route families expose training, history and nutrition. Existing local edits fix Today hook ordering and data formatting and must be retained. The master plan is PIANO_RIPROGETTAZIONE_UX.md.

## Goals / Non-Goals

Goals: implement the first usable navigation increment, make history/programs discoverable, reduce Today/calendar clutter, and retain context when opening a session.

Non-goals: new AI model selection, new goal algorithms, cross-program compatibility, draft persistence, external writes, or a complete redesign of every legacy detail page.

## Decisions

- Keep current URLs for Today, Week, Body and Nutrition; label them Oggi, Piano, Recupero and Nutrizione. Add activities and program/goal overview routes. This preserves existing links instead of a large route migration.
- Replace the swipe pager in the tabs layout with normal route rendering. Global gestures interfere with the calendar and keep inactive views interactive. Use browser navigation and contextual links instead.
- Keep legacy detail widths; expand only the new workspace on desktop with a fixed labeled sidebar. New content uses a restrained hierarchy: white #ffffff, surface #f6f6f6, ink #1a1a1a, muted #555555, accent #d92d55, selection #ffe9ec. Retain Plus Jakarta Sans, tabular numbers and existing clay illustrations. Use compact left-aligned lists, one dominant daily training card and native scroll. Avoid extra gradients and ornamental cards.
- Use shared page headings/profile access and local Piano subnavigation. Move plan-management and generation out of the calendar into Programmi, explicitly preserving current immediate-generation semantics until a dedicated draft increment.
- Use stored activity history with its existing normalized identity/source. Present summary details inline; expose existing technique analysis separately rather than linking an unsupported activity to a fake detail.
- Add allowlisted local return context to session links, preserve date query state in Piano, and use native back navigation when the origin was actually visited. Direct links fall back to a validated local route.
- Existing move confirmation/validation remains authoritative. A date picker adds a single-pointer alternative to dragging.

## Risks / Trade-offs

- Unmounting tabs loses local transient state → persist relevant period/filter selections in URLs; browser back handles scroll restoration.
- Existing screens assume a phone-width shell → scope expanded layout to workspace routes, retain legacy detail widths.
- New program navigation could imply unimplemented safe draft behavior → label generation as updating the current program and defer service changes explicitly.
- Live services/auth may be unavailable in tests → browser tests use local intercepted fixtures, never production writes; separately run compilation and lint.

## Migration Plan

No schema changes or new dependencies. Existing routes continue working. Ship as a cohesive frontend increment; rollback by reverting only this increment's edits. Keep the complete master plan as the record of subsequent work.

## Open Questions

Full goal generalization and coordinated generation remain separately scoped follow-up work.
