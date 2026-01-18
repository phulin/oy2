# Backend Test Suite

## Overview
The backend tests exercise the worker API routes with an in-memory FakeD1 + FakeKV
environment to avoid external dependencies while keeping the route logic intact.

## Coverage
- Auth flows (start, verify, session, logout) with phone-auth toggles and OTP mocks.
- Users (create, search, suggested mutuals).
- Friends (add, list, last-yo metadata).
- Oys/Los (friend gating, notification payloads, cursor pagination).
- Push subscriptions (subscribe/unsubscribe validation).
- Admin endpoints (stats, phone-auth toggles).

## Files
- `production_schema.sql` for the schema snapshot.
- `tests/worker/testUtils.ts` for FakeD1/FakeKV + helpers.
- `tests/worker/testHelpers.ts` for request + OTP mocks.
- Route test files under `tests/worker/*.test.ts`.

## Running
- `yarn check`
- `yarn lint`
- `yarn format`
- `node --test tests/worker/*.test.ts`
