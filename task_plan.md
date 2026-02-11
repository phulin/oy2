# Task Plan: Friend Profile Cards + Moderation Actions

## Goal
Add a username-tap route with scrollable full-screen friend profile cards (username, friend count, lifetime Oy sent/received) and unfriend/block/report actions, including DB migrations, API endpoints, and admin tooling.

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Research current frontend/backend schema and admin structure
- [x] Phase 3: Implement database migrations and schema updates
- [x] Phase 4: Implement API endpoints and app context wiring
- [x] Phase 5: Implement new route/screen and action UI
- [x] Phase 6: Implement admin panel updates
- [x] Phase 7: Validate (check/lint/format/tests) and deliver

## Key Questions
1. Where are DB migrations and SQL schema canonically managed?
2. What admin panel architecture exists and where to add moderation views/actions?
3. How are friend relationships currently represented and counted?

## Decisions Made
- Use username tap to navigate to a dedicated friend profile cards route.
- Keep report as a first-class persisted entity (DB + admin visibility).
- Keep moderation actions on each profile card under the metrics area.
- Implement profile cards as vertically scrollable, snap-aligned, near full-screen cards.

## Errors Encountered
- Type mismatch on card refs (`HTMLElement` vs `HTMLDivElement`) fixed by widening ref type.
- Test harness failed on new SQL; extended `FakeD1Database` emulation for moderation tables/queries.

## Status
**Completed** - Feature implemented and validated with typecheck, lint, format, and tests.
