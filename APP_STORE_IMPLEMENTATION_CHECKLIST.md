# Oy App Store Implementation Checklist (Remaining Work)

This file tracks the remaining implementation work after the initial account deletion pass.

## 1) Account Deletion Follow-Ups

- [ ] Require recent re-auth before deletion (passkey or email code challenge) in `/src/components/SettingsScreen.tsx` and `/worker/routes/auth.ts`.
- [ ] Add a second irreversible confirmation step (explicit final confirm after `DELETE` match) in `/src/components/SettingsScreen.tsx`.
- [ ] Ensure account deletion action is rate-limited server-side in `/worker/routes/auth.ts`.
- [ ] Update privacy language to explicitly describe in-app deletion behavior and timing in `/public/privacy.txt`.
- [ ] Add worker tests for deletion success and unauthenticated rejection in `/tests/worker/auth.test.ts`.

## 2) UGC Safety Controls (Block + Report + Moderation)

- [ ] Add `blocks` table migration in `/migrations-pg` with `(user_id, blocked_user_id, created_at)` and indexes.
- [ ] Add `reports` table migration in `/migrations-pg` with reporter, target user/content reference, reason, status, created_at.
- [ ] Update `/production_schema.sql` to reflect new tables and indexes.
- [ ] Add API endpoints:
  - [ ] `POST /api/users/block`
  - [ ] `DELETE /api/users/block/:id`
  - [ ] `POST /api/reports`
  in `/worker/routes/users.ts` or new route files registered from `/worker/index.ts`.
- [ ] Enforce block rules in friend search/suggestions in `/worker/routes/users.ts`.
- [ ] Enforce block rules in send/fetch Oys paths in `/worker/routes/oys.ts`.
- [ ] Add block/report actions to UI:
  - [ ] Friend-level actions in `/src/components/FriendsList.tsx`
  - [ ] Oy-level actions in `/src/components/OysList.tsx`
- [ ] Add report queue/admin tooling in `/src/components/AdminDashboard.tsx` and matching backend route.
- [ ] Add minimal abusive-username/content filter server-side in `/worker/routes/auth.ts` and relevant write endpoints.
- [ ] Add tests for block/report behavior in `/tests/worker`.

## 3) Sign in with Apple

- [ ] Enable Apple provider in `/capacitor.config.ts`.
- [ ] Add "Continue with Apple" to login UI in `/src/components/LoginScreen.tsx`.
- [ ] Implement Apple OAuth/native verify endpoints in `/worker/routes/oauth.ts`.
- [ ] Add required env vars to worker config/docs for Apple credentials.
- [ ] Handle account-linking cases (existing email/passkey user) in `/worker/routes/oauth.ts`.
- [ ] Add tests for Apple auth flow in `/tests/worker/oauth.test.ts`.

## 4) Location Permission Compliance

- [ ] Add `NSLocationWhenInUseUsageDescription` to `/ios/App/App/Info.plist`.
- [ ] Add first-time location explainer screen/modal before `Lo` permission request in `/src/App.tsx`.
- [ ] Add denied-permission UX and retry/help path in `/src/App.tsx` and `/src/components/FriendsList.tsx` (Lo action flow).
- [ ] Confirm copy accurately matches actual usage (friend-to-friend location sharing only).

## 5) Submission Readiness

- [ ] Prepare App Review notes with exact tester path (sign in, add friend, send Oy/Lo, report, block, delete account).
- [ ] Prepare a review/demo account with realistic seed data.
- [ ] Verify privacy details in App Store Connect match app behavior.
- [ ] Verify legal/support links are reachable in production.

## 6) Final Engineering Validation

- [ ] Run `yarn check && yarn lint:fix && yarn format:fix`.
- [ ] Run worker tests (`yarn test`) and fix regressions.
- [ ] Manual iOS verification on device:
  - [ ] passkey login
  - [ ] email login
  - [ ] Google login
  - [ ] Apple login
  - [ ] push notifications
  - [ ] location share + permission flows
  - [ ] block/report
  - [ ] account deletion

