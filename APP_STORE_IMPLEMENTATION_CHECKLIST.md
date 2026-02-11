# Oy App Store Implementation Checklist (Current Status)

This file tracks App Store readiness work with current implementation status.

## 1) Account Deletion Follow-Ups

- [x] Move `Type DELETE` confirmation into a dedicated modal in `/src/components/SettingsScreen.tsx`.
- [x] Keep irreversible final confirmation in modal before account deletion in `/src/components/SettingsScreen.tsx`.
- [x] Ensure account deletion action is rate-limited server-side in `/worker/routes/auth.ts`.
- [x] Update privacy language to explicitly describe in-app deletion behavior and timing in `/public/privacy.txt`.
- [x] Add worker tests for deletion success and unauthenticated rejection in `/tests/worker/auth.test.ts`.

## 2) UGC Safety Controls (Block + Report + Moderation)

- [x] Add block/report table migration in `/migrations-pg`.
- [x] Update `/production_schema.sql` to reflect moderation tables and indexes.
- [x] Add block/report API endpoints (implemented as friend-level routes):
  - `POST /api/friends/:friendId/block`
  - `POST /api/friends/:friendId/report`
- [ ] Add unblock endpoint (if required for policy/product), e.g. `DELETE /api/users/block/:id`.
- [ ] Enforce block rules in friend search/suggestions in `/worker/routes/users.ts`.
- [ ] Enforce block rules in fetch Oys path in `/worker/routes/oys.ts` (send path is already enforced).
- [x] Add friend-level block/report actions to UI (implemented in `/src/components/FriendProfileCardsScreen.tsx`).
- [ ] Add Oy-level report/block actions to UI in `/src/components/OysList.tsx`.
- [x] Add report queue/admin tooling in `/src/components/AdminDashboard.tsx` and `/worker/routes/admin.ts`.
- [ ] Add minimal abusive-username/content filter server-side in `/worker/routes/auth.ts` and relevant write endpoints.
- [ ] Add/expand worker tests for block/report behavior in `/tests/worker`.

## 3) Sign in with Apple

- [x] Enable Apple provider in `/capacitor.config.ts`.
- [x] Add Apple sign-in buttons to login UI in `/src/components/LoginScreen.tsx`.
- [x] Implement Apple OAuth/native verify endpoints in `/worker/routes/oauth.ts`.
- [x] Add required env vars/config/docs for Apple credentials.
- [x] Handle account-linking/claiming cases in `/worker/routes/oauth.ts`.
- [x] Add tests for Apple auth flow in `/tests/worker/oauth.test.ts`.

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
