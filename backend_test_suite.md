# Backend Test Suite

## Overview
The backend tests exercise the worker API routes with an in-memory FakeD1 + FakeKV
environment to avoid external dependencies while keeping the route logic intact.

## Coverage
- Auth flows (session, logout).
- Users (create, search, suggested mutuals).
- Friends (add, list, last-oy metadata).
- Oys/Los (friend gating, notification payloads, cursor pagination).
- Push subscriptions (subscribe/unsubscribe validation).
- Admin endpoints (stats).

## Files
- `production_schema.sql` for the schema snapshot.
- `tests/worker/testUtils.ts` for FakeD1/FakeKV + helpers.
- `tests/worker/testHelpers.ts` for request helpers.
- Route test files under `tests/worker/*.test.ts`.

## Running
- `yarn check`
- `yarn lint:fix`
- `yarn format:fix`
- `yarn test`
