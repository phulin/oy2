# Task Plan: Fix failing tests and add last_yo info API coverage

## Goal
Resolve 500 errors in tests and update tests to cover the new last_yo info API behavior.

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Research/gather information
- [x] Phase 3: Execute/build
- [x] Phase 4: Review and deliver

## Key Questions
1. What is causing the current test 500s?
2. Which tests should be updated or added for `/api/last-yo-info`?

## Decisions Made
- Update FakeD1 to support `last_yo_info` queries and inserts.
- Shift friends list tests to `/api/last-yo-info` for last yo/streak assertions.

## Errors Encountered
- None.

## Status
**Complete**
