## ADDED Requirements

### Requirement: Week header stays pinned while the day list scrolls
The week screen's brand mark, week date-range selector (previous/next controls and the date label), and weekly progress bar SHALL remain visible at the top of the viewport while the day-card list beneath them is scrolled, using the same sticky-header treatment as the `diff` screen (opaque background, pinned to the top edge, layered above scrolling content).

#### Scenario: Scrolling the day list keeps the selector visible
- **WHEN** a user on `/week` scrolls down through the day-card list
- **THEN** the brand mark, ‹ date range › selector, and progress bar stay fixed at the top of the viewport and do not scroll out of view

#### Scenario: Scrolled content does not show through the header
- **WHEN** day cards scroll underneath the pinned header
- **THEN** the header renders with an opaque background so scrolled content is fully hidden behind it, not visible through or overlapping it

#### Scenario: Week navigation still works while pinned
- **WHEN** a user taps the previous (‹) or next (›) week control while the header is pinned
- **THEN** the displayed week changes exactly as it does today, with no change to the paging behavior itself
