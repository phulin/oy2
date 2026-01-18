import { getPhoneAuthEnabled, requireAdmin, setPhoneAuthEnabled } from "../lib";
import type { App } from "../types";

export function registerAdminRoutes(app: App) {
	app.get("/api/admin/stats", async (c) => {
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
		] = await c.env.DB.batch([
			c.env.DB.prepare(
				`
      SELECT id, username, last_seen
      FROM users
      WHERE last_seen >= ?
        AND EXISTS (
          SELECT 1 FROM sessions WHERE sessions.user_id = users.id
        )
      ORDER BY last_seen DESC
    `,
			).bind(since),
			c.env.DB.prepare(
				"SELECT COUNT(*) as count FROM notifications WHERE created_at >= ?",
			).bind(since),
			c.env.DB.prepare(
				`
      SELECT
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        COUNT(*) as total_count
      FROM notification_deliveries
      WHERE created_at >= ?
    `,
			).bind(since),
			c.env.DB.prepare("SELECT COUNT(*) as count FROM users"),
			c.env.DB.prepare("SELECT COUNT(*) as count FROM push_subscriptions"),
		]);

		const notificationsRow = notificationsQuery.results?.[0] as
			| { count?: number | null }
			| undefined;
		const deliveriesRow = deliveriesQuery.results?.[0] as
			| { total_count?: number | null; success_count?: number | null }
			| undefined;
		const usersCountRow = usersCountQuery.results?.[0] as
			| { count?: number | null }
			| undefined;
		const subscriptionsCountRow = subscriptionsCountQuery.results?.[0] as
			| { count?: number | null }
			| undefined;

		const notificationsSent = Number(notificationsRow?.count ?? 0);
		const totalDeliveries = Number(deliveriesRow?.total_count ?? 0);
		const successDeliveries = Number(deliveriesRow?.success_count ?? 0);

		const stats = {
			activeUsersCount: (activeUsersQuery.results || []).length,
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
			activeUsers: (activeUsersQuery.results || []) as Array<{
				id: number;
				username: string;
				last_seen: number;
			}>,
			generatedAt: now,
		});
	});

	app.get("/api/admin/phone-auth", async (c) => {
		const adminCheck = requireAdmin(c);
		if (!adminCheck.ok) {
			return c.json(adminCheck.response, adminCheck.status);
		}

		const enabled = await getPhoneAuthEnabled(c.env);
		return c.json({ enabled });
	});

	app.put("/api/admin/phone-auth", async (c) => {
		const adminCheck = requireAdmin(c);
		if (!adminCheck.ok) {
			return c.json(adminCheck.response, adminCheck.status);
		}

		const { enabled } = await c.req.json();
		if (typeof enabled !== "boolean") {
			return c.json({ error: "Missing enabled flag" }, 400);
		}

		await setPhoneAuthEnabled(c.env, enabled);
		return c.json({ enabled });
	});
}
