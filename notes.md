# Notes: Friend Profile Cards + Moderation Actions

## Findings
- Existing app uses Solid routes under `/` with `AppContext` for shared API/state actions.
- Friend list was rendered in `src/components/FriendsList.tsx` with username as static text.
- Backend friend/admin logic is in `worker/routes/friends.ts` and `worker/routes/admin.ts`.
- Production schema snapshot is maintained in `production_schema.sql` and must be updated alongside migrations.

## Implementation Notes
- Added migration `migrations-pg/0011_add_friend_moderation_and_profile_tables.sql` for:
  - `user_blocks`
  - `user_reports`
- Added new backend endpoints:
  - `GET /api/friends/profiles`
  - `DELETE /api/friends/:friendId`
  - `POST /api/friends/:friendId/block`
  - `POST /api/friends/:friendId/report`
- Added block checks in friend-add and oy/lo send paths.
- Added admin moderation visibility in `/api/admin/stats` payload:
  - open reports count
  - total blocks count
  - recent reports list
  - recent blocks list
- Added new UI route and component:
  - `/friends/cards`
  - scrollable full-screen profile cards with action panel
- Username tap from friends list now navigates to the cards route focused on that friend.
- Extended test fake DB SQL support for moderation tables/queries.

## Validation
- `yarn check`
- `yarn lint:fix`
- `yarn format:fix`
- `yarn test`
- All passed.
