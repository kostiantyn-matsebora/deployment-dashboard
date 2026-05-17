# focus-on-last-event-toggle

The header's "Focus on last event" toggle is a per-user UI preference
(`localStorage`-backed) that decides whether incoming SSE slot-update
events also drive viewport behaviour. ON: the affected service row
scrolls into view and pulses. OFF: the SPA still applies the update
to the store but does not scroll or pulse off-screen rows; rows
already on-screen pulse to draw the eye.

## Citations

- Mockup `docs/ui/deployment-dashboard.html` header section — the
  "Focus on last event" checkbox between "Failures only" and the
  "Simulate event" button.
- SAD §5 NFR-03 "Live updates within 5 s of a successful ingest"
  — the toggle controls the *visual response* to the same event;
  the underlying live-update budget is unchanged either way.
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md`
  "Client-side persistence (`localStorage`)" — pattern for every other
  user preference (view, attribute set, layout, correlation attribute);
  this toggle follows the same pattern with the key
  `dashboard.focusOnLastEvent`.
- The previously-shipped behaviour was lost at some point during the
  four-views refactor; frontend is restoring it in this cycle.

## Preconditions

- Canonical 6-state corpus seeded (the SPA shows ~12 services in a
  list / matrix).
- `localStorage` cleared before the test (Playwright fresh context).
- Viewport height set small enough that the corpus overflows
  (e.g. 600 px) so "off-screen" is observable.

## Steps — ON

1. **Given** the SPA at `/` with `dashboard.focusOnLastEvent`
   absent from `localStorage`.
2. **When** I click the "Focus on last event" checkbox to ON.
3. **Then** `localStorage.getItem('dashboard.focusOnLastEvent')`
   returns `'true'` (string-cast booleans, same as our other
   `localStorage` keys).
4. **Given** I scroll to the top of the matrix so a known service
   row is off-screen below the fold.
5. **When** a Write API POST lands a fresh deployment for that
   off-screen service (via `testing/scripts/test-notify.ps1` or a
   direct POST).
6. **Then** within NFR-03's 5 s budget:
   - The page scrolls so the affected service row is visible
     (`row.scrollIntoView({block: 'nearest'})`).
   - The row pulses (a CSS class such as `pulse` / `swap-pulse`
     attaches to it briefly).

## Steps — OFF

1. **Given** the SPA with the toggle now OFF (uncheck the box).
2. **Then** `localStorage.getItem('dashboard.focusOnLastEvent')`
   returns `'false'` or is absent (the SPA may delete the key to
   represent default-off — either form is acceptable).
3. **Given** the same off-screen service.
4. **When** another POST lands a fresh deployment for that service.
5. **Then** within the same 5 s budget:
   - No scroll occurs (verify `window.scrollY` is unchanged).
   - The affected (still off-screen) row receives the update in the
     SPA store BUT does NOT trigger pulse animation while off-screen.
   - Any row currently on-screen for the same service (if the user
     scrolled it into view manually) may pulse — pulse remains valid
     when the row is visible; it just does not force scroll.

## Expected results (observable)

- `data-testid="focus-on-last-event-toggle"` exists and is a checkbox
  that reflects `localStorage['dashboard.focusOnLastEvent']`.
- ON: after a POST to an off-screen service `S`,
  `getBoundingClientRect()` of `[data-service-row="<S>"]` (or its
  Glance pill) intersects the viewport within 5 s of the POST.
- OFF: under the same POST, the recorded `window.scrollY` immediately
  before the POST equals the value at +5 s ±2 px (no programmatic
  scroll).
- The matrix data updates regardless of the toggle (the toggle is
  *viewport-only*, not a data filter).

## Out of scope

- Pulse colour / duration — the toggle controls *whether* the pulse
  fires for off-screen rows, not what it looks like.
- Multi-event coalescing within the 5 s window — that's its own
  optimisation; the toggle test uses a single POST so coalescing
  is irrelevant.

## Coverage

Validates: SAD §5 NFR-03 (live-update budget unchanged), mockup
header behaviour, the established `localStorage` persistence pattern.
