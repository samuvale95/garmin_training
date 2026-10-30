## Why

Passo's everyday actions and history are spread across inconsistent entry points. This first implementation increment of PIANO_RIPROGETTAZIONE_UX.md makes navigation and the daily training journey predictable while retaining existing data and operations.

## What Changes

- Five labeled primary destinations: Oggi, Piano, Attività, Recupero, Nutrizione, with a desktop sidebar and persistent mobile navigation.
- Dedicated Programmi and Obiettivi entry points under Piano, using existing capabilities without promising the future draft/activation service.
- Activity history with period/sport/text filters using stored activities, and stable links to existing analysis and summaries.
- A shorter Today hierarchy with visible additional sessions and a calendar-first Piano view.
- Contextual return from session details, preserving the originating calendar date; an explicit move action using existing move validation.
- Replace the global swipe pager with route-based navigation; preserve existing URLs.

## Capabilities

### New Capabilities
- `ux-navigation-foundations`: Stable navigation, discoverable program/history entry points, daily hierarchy and contextual session return.

### Modified Capabilities
None. Existing training and activity service contracts remain unchanged in this increment.

## Impact

Next.js layouts, navigation, Today/Week views, session links and new history/program entry pages. No new dependencies or database migrations. Existing local changes are preserved. Generalized goals, cross-program planning, durable drafts, and the complete nutrition/editor redesign remain subsequent increments in the master plan.
