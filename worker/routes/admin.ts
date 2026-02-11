import { requireAdmin } from "../lib";
import { checkNativePushHealthWithOptions } from "../push";
import type { App, AppContext, BlockedUserRow, UserReportRow } from "../types";

export function registerAdminRoutes(app: App) {
	app.get("/api/admin/stats", async (c: AppContext) => {
		const adminCheck = requireAdmin(c);
		if (!adminCheck.ok) {
			return c.json(adminCheck.response, adminCheck.status);
		}

		const now = Math.floor(Date.now() / 1000);
		const since = now - 60 * 60 * 24;

		const [
			activeUsersQuery,
			notificationsQuery,
			deliveriesQuery,
			usersCountQuery,
			subscriptionsCountQuery,
			openReportsCountQuery,
			totalBlocksCountQuery,
			recentReportsQuery,
			recentBlocksQuery,
		] = await Promise.all([
			c.get("db").query(
				`
      SELECT
        users.id,
        users.username,
        uls.last_seen,
        (
          users.email IS NOT NULL
          OR users.oauth_provider IS NOT NULL
          OR EXISTS (SELECT 1 FROM passkeys WHERE passkeys.user_id = users.id)
        ) AS has_auth_methods,
        (
          SELECT COUNT(*) FROM push_subscriptions ps WHERE ps.user_id = users.id
        ) AS push_subscriptions_count
      FROM users
      JOIN user_last_seen uls ON uls.user_id = users.id
      WHERE uls.last_seen >= $1
        AND EXISTS (
          SELECT 1 FROM sessions WHERE sessions.user_id = users.id
        )
      ORDER BY uls.last_seen DESC
    `,
				[since],
			),
			c
				.get("db")
				.query(
					"SELECT COUNT(*) as count FROM notifications WHERE created_at >= $1",
					[since],
				),
			c.get("db").query(
				`
      SELECT
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        COUNT(*) as total_count
      FROM notification_deliveries
      WHERE created_at >= $1
    `,
				[since],
			),
			c.get("db").query("SELECT COUNT(*) as count FROM users"),
			c.get("db").query("SELECT COUNT(*) as count FROM push_subscriptions"),
			c
				.get("db")
				.query(
					"SELECT COUNT(*) as count FROM user_reports WHERE status = 'open'",
				),
			c.get("db").query("SELECT COUNT(*) as count FROM user_blocks"),
			c.get("db").query<UserReportRow>(
				`
					SELECT
						r.id,
						r.reporter_user_id,
						r.target_user_id,
						reporter.username AS reporter_username,
						target.username AS target_username,
						r.reason,
						r.details,
						r.status,
						r.created_at
					FROM user_reports r
					INNER JOIN users reporter ON reporter.id = r.reporter_user_id
					INNER JOIN users target ON target.id = r.target_user_id
					ORDER BY r.created_at DESC
					LIMIT 100
				`,
			),
			c.get("db").query<BlockedUserRow>(
				`
					SELECT
						b.blocker_user_id,
						b.blocked_user_id,
						blocker.username AS blocker_username,
						blocked.username AS blocked_username,
						b.created_at
					FROM user_blocks b
					INNER JOIN users blocker ON blocker.id = b.blocker_user_id
					INNER JOIN users blocked ON blocked.id = b.blocked_user_id
					ORDER BY b.created_at DESC
					LIMIT 100
				`,
			),
		]);

		const notificationsRow = notificationsQuery.rows[0] as
			| { count?: number | null }
			| undefined;
		const deliveriesRow = deliveriesQuery.rows[0] as
			| { total_count?: number | null; success_count?: number | null }
			| undefined;
		const usersCountRow = usersCountQuery.rows[0] as
			| { count?: number | null }
			| undefined;
		const subscriptionsCountRow = subscriptionsCountQuery.rows[0] as
			| { count?: number | null }
			| undefined;
		const openReportsCountRow = openReportsCountQuery.rows[0] as
			| { count?: number | null }
			| undefined;
		const totalBlocksCountRow = totalBlocksCountQuery.rows[0] as
			| { count?: number | null }
			| undefined;

		const notificationsSent = Number(notificationsRow?.count ?? 0);
		const totalDeliveries = Number(deliveriesRow?.total_count ?? 0);
		const successDeliveries = Number(deliveriesRow?.success_count ?? 0);

		const stats = {
			activeUsersCount: activeUsersQuery.rows.length,
			notificationsSent,
			deliveryAttempts: totalDeliveries,
			deliverySuccessCount: successDeliveries,
			deliveryFailureCount: Math.max(0, totalDeliveries - successDeliveries),
			deliverySuccessRate: totalDeliveries
				? successDeliveries / totalDeliveries
				: 0,
			subscriptionsCount: Number(subscriptionsCountRow?.count ?? 0),
			usersCount: Number(usersCountRow?.count ?? 0),
			openReportsCount: Number(openReportsCountRow?.count ?? 0),
			totalBlocksCount: Number(totalBlocksCountRow?.count ?? 0),
		};

		return c.json({
			stats,
			activeUsers: activeUsersQuery.rows as Array<{
				id: number;
				username: string;
				last_seen: number;
				has_auth_methods: boolean;
				push_subscriptions_count: number;
			}>,
			recentReports: recentReportsQuery.rows.map((row) => ({
				id: row.id,
				reporterUserId: row.reporter_user_id,
				targetUserId: row.target_user_id,
				reporterUsername: row.reporter_username,
				targetUsername: row.target_username,
				reason: row.reason,
				details: row.details,
				status: row.status,
				createdAt: row.created_at,
			})),
			recentBlocks: recentBlocksQuery.rows.map((row) => ({
				blockerUserId: row.blocker_user_id,
				blockedUserId: row.blocked_user_id,
				blockerUsername: row.blocker_username,
				blockedUsername: row.blocked_username,
				createdAt: row.created_at,
			})),
			generatedAt: now,
		});
	});

	app.get("/api/admin/push/health", async (c: AppContext) => {
		const adminCheck = requireAdmin(c);
		if (!adminCheck.ok) {
			return c.json(adminCheck.response, adminCheck.status);
		}

		const health = await checkNativePushHealthWithOptions(c.env, {
			requestUrl: c.req.url,
		});
		return c.json({
			ok: health.fcm.ok || health.apns.ok,
			fcm: health.fcm,
			apns: health.apns,
			generatedAt: Math.floor(Date.now() / 1000),
		});
	});
}
