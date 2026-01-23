import { requireAdmin } from "../lib";
import type { App, AppContext } from "../types";

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
			generatedAt: now,
		});
	});
}
