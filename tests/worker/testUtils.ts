import type { ExecutionContext } from "@cloudflare/workers-types";

type UserRow = {
	id: number;
	username: string;
	created_at: number;
	phone: string | null;
	phone_verified: number | null;
	admin: number | null;
};

type UserLastSeenRow = {
	user_id: number;
	last_seen: number;
};

type FriendshipRow = {
	user_id: number;
	friend_id: number;
	created_at: number;
	last_oy_id: number | null;
	last_oy_type: string | null;
	last_oy_created_at: number | null;
	last_oy_from_user_id: number | null;
	streak: number;
	streak_start_date: number | null;
};

type LastOyInfoRow = {
	user_id: number;
	friend_id: number;
	last_oy_id: number | null;
	last_oy_type: string | null;
	last_oy_created_at: number | null;
	last_oy_from_user_id: number | null;
	streak: number;
	streak_start_date: number | null;
};

type OyRow = {
	id: number;
	from_user_id: number;
	to_user_id: number;
	type: string | null;
	payload: string | null;
	created_at: number;
};

type PushSubscriptionRow = {
	user_id: number;
	endpoint: string;
	keys_p256dh: string;
	keys_auth: string;
	created_at: number;
};

type NotificationRow = {
	id: number;
	to_user_id: number;
	from_user_id: number;
	type: string;
	payload: string;
	created_at: number;
};

type NotificationDeliveryRow = {
	id: number;
	notification_id: number;
	endpoint: string;
	attempt: number;
	success: number;
	status_code: number | null;
	error_message: string | null;
	created_at: number;
};

type SessionRow = {
	token: string;
	user_id: number;
	created_at: number;
};

type D1Result = {
	success: boolean;
	meta: { last_row_id: number; changes: number };
	results?: unknown[];
};

type D1PreparedStatement = {
	bind: (...params: unknown[]) => D1PreparedStatement;
	run: () => Promise<D1Result>;
	all: () => Promise<{ results: unknown[] }>;
	first: () => Promise<unknown | null>;
};

const normalizeSql = (sql: string) =>
	sql.replace(/\s+/g, " ").trim().replace(/\$\d+/g, "?");

export class FakeKV {
	private store = new Map<string, string>();

	async get(key: string, type?: "json") {
		const value = this.store.get(key) ?? null;
		if (value === null) {
			return null;
		}
		if (type === "json") {
			return JSON.parse(value) as unknown;
		}
		return value;
	}

	async put(key: string, value: string) {
		this.store.set(key, value);
	}

	async delete(key: string) {
		this.store.delete(key);
	}
}

export class FakeD1Database {
	users: UserRow[] = [];
	userLastSeen: UserLastSeenRow[] = [];
	friendships: FriendshipRow[] = [];
	lastOyInfo: LastOyInfoRow[] = [];
	oys: OyRow[] = [];
	pushSubscriptions: PushSubscriptionRow[] = [];
	notifications: NotificationRow[] = [];
	notificationDeliveries: NotificationDeliveryRow[] = [];
	sessions: SessionRow[] = [];
	nextUserId = 1;
	nextOyId = 1;
	nextNotificationId = 1;
	nextNotificationDeliveryId = 1;
	lastInsertId = 0;

	prepare(sql: string): D1PreparedStatement {
		return new FakeD1PreparedStatement(this, sql);
	}

	async batch(statements: D1PreparedStatement[]) {
		const results: D1Result[] = [];
		for (const statement of statements) {
			if (statement instanceof FakeD1PreparedStatement) {
				const sql = normalizeSql(statement.sql);
				if (sql.startsWith("SELECT") || sql.startsWith("WITH")) {
					const { results: rows } = await statement.all();
					results.push({
						success: true,
						meta: { last_row_id: 0, changes: 0 },
						results: rows,
					});
					continue;
				}
			}
			results.push(await statement.run());
		}
		return results;
	}
}

export class FakePgClient {
	constructor(private db: FakeD1Database) {}

	async query(sql: string, params: unknown[] = []) {
		const statement = new FakeD1PreparedStatement(this.db, sql);
		statement.bind(...params);
		const normalized = normalizeSql(sql);
		if (normalized.startsWith("SELECT") || normalized.startsWith("WITH")) {
			const { results } = await statement.all();
			return { rows: results, rowCount: results.length };
		}
		if (normalized.includes("RETURNING")) {
			const row = await statement.first();
			return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
		}
		const result = await statement.run();
		return { rows: result.results ?? [], rowCount: result.meta.changes };
	}

	async end() {}
}

class FakeD1PreparedStatement implements D1PreparedStatement {
	private params: unknown[] = [];

	constructor(
		private db: FakeD1Database,
		readonly sql: string,
	) {}

	bind(...params: unknown[]) {
		this.params = params;
		return this;
	}

	async run() {
		const sql = normalizeSql(this.sql);
		if (sql.startsWith("INSERT INTO users (username, phone, phone_verified)")) {
			const [username, phone, phoneVerified] = this.params as [
				string,
				string | null,
				number | null,
			];
			const existing = this.db.users.find(
				(user) => user.username.toLowerCase() === username.toLowerCase(),
			);
			if (existing) {
				return { success: false, meta: { last_row_id: 0, changes: 0 } };
			}
			const user = seedUser(this.db, {
				username,
				phone: phone ?? null,
				phoneVerified: phoneVerified ?? 0,
			});
			return { success: true, meta: { last_row_id: user.id, changes: 1 } };
		}
		if (sql.startsWith("INSERT INTO users (username) VALUES")) {
			const [username] = this.params as [string];
			const existing = this.db.users.find(
				(user) => user.username.toLowerCase() === username.toLowerCase(),
			);
			if (existing) {
				return { success: false, meta: { last_row_id: 0, changes: 0 } };
			}
			const user = seedUser(this.db, { username });
			return { success: true, meta: { last_row_id: user.id, changes: 1 } };
		}
		if (sql.startsWith("UPDATE users SET phone = ?, phone_verified = 0")) {
			const [phone, userId] = this.params as [string, number];
			const user = this.db.users.find((row) => row.id === userId);
			if (user) {
				user.phone = phone;
				user.phone_verified = 0;
				return { success: true, meta: { last_row_id: 0, changes: 1 } };
			}
			return { success: true, meta: { last_row_id: 0, changes: 0 } };
		}
		if (sql.startsWith("UPDATE users SET phone = ? WHERE id = ?")) {
			const [phone, userId] = this.params as [string, number];
			const user = this.db.users.find((row) => row.id === userId);
			if (user) {
				user.phone = phone;
				return { success: true, meta: { last_row_id: 0, changes: 1 } };
			}
			return { success: true, meta: { last_row_id: 0, changes: 0 } };
		}
		if (sql.startsWith("UPDATE users SET phone_verified = 1")) {
			const [userId] = this.params as [number];
			const user = this.db.users.find((row) => row.id === userId);
			if (user) {
				user.phone_verified = 1;
				return { success: true, meta: { last_row_id: 0, changes: 1 } };
			}
			return { success: true, meta: { last_row_id: 0, changes: 0 } };
		}
		if (sql.startsWith("INSERT INTO user_last_seen")) {
			const [userId, lastSeen] = this.params as [number, number];
			const existing = this.db.userLastSeen.find(
				(row) => row.user_id === userId,
			);
			if (existing) {
				existing.last_seen = lastSeen;
			} else {
				this.db.userLastSeen.push({ user_id: userId, last_seen: lastSeen });
			}
			return { success: true, meta: { last_row_id: 0, changes: 1 } };
		}
		if (sql.startsWith("INSERT INTO sessions (token, user_id)")) {
			const [token, userId] = this.params as [string, number];
			this.db.sessions.push({
				token,
				user_id: userId,
				created_at: nowSeconds(),
			});
			return { success: true, meta: { last_row_id: 0, changes: 1 } };
		}
		if (sql.startsWith("DELETE FROM sessions WHERE token = ?")) {
			const [token] = this.params as [string];
			const before = this.db.sessions.length;
			this.db.sessions = this.db.sessions.filter(
				(session) => session.token !== token,
			);
			const changes = before - this.db.sessions.length;
			return { success: true, meta: { last_row_id: 0, changes } };
		}
		if (sql.startsWith("INSERT INTO friendships")) {
			const [userId, friendId] = this.params as [number, number];
			const existing = this.db.friendships.find(
				(row) => row.user_id === userId && row.friend_id === friendId,
			);
			if (existing) {
				return { success: true, meta: { last_row_id: 0, changes: 0 } };
			}
			this.db.friendships.push({
				user_id: userId,
				friend_id: friendId,
				created_at: nowSeconds(),
				last_oy_id: null,
				last_oy_type: null,
				last_oy_created_at: null,
				last_oy_from_user_id: null,
				streak: 1,
				streak_start_date: null,
			});
			return { success: true, meta: { last_row_id: 0, changes: 1 } };
		}
		if (sql.startsWith("INSERT INTO last_oy_info")) {
			const [
				userId,
				friendId,
				lastOyId,
				lastOyType,
				lastOyCreatedAt,
				lastOyFromUserId,
				streakStartDate,
				startOfYesterdayNY,
			] = this.params as [
				number,
				number,
				number,
				string | null,
				number,
				number,
				number,
				number,
			];
			const existing = this.db.lastOyInfo.find(
				(row) => row.user_id === userId && row.friend_id === friendId,
			);
			if (existing) {
				const previousLastOyCreatedAt = existing.last_oy_created_at;
				existing.last_oy_id = lastOyId;
				existing.last_oy_type = lastOyType;
				existing.last_oy_created_at = lastOyCreatedAt;
				existing.last_oy_from_user_id = lastOyFromUserId;
				if (
					previousLastOyCreatedAt === null ||
					previousLastOyCreatedAt < startOfYesterdayNY
				) {
					existing.streak_start_date = streakStartDate;
				}
				return { success: true, meta: { last_row_id: 0, changes: 1 } };
			}
			this.db.lastOyInfo.push({
				user_id: userId,
				friend_id: friendId,
				last_oy_id: lastOyId,
				last_oy_type: lastOyType,
				last_oy_created_at: lastOyCreatedAt,
				last_oy_from_user_id: lastOyFromUserId,
				streak: 1,
				streak_start_date: streakStartDate,
			});
			return { success: true, meta: { last_row_id: 0, changes: 1 } };
		}
		if (sql.startsWith("INSERT INTO oys")) {
			const [fromUserId, toUserId, type, payload, createdAt] = this.params as [
				number,
				number,
				string,
				string | null,
				number,
			];
			const oy: OyRow = {
				id: this.db.nextOyId++,
				from_user_id: fromUserId,
				to_user_id: toUserId,
				type,
				payload,
				created_at: createdAt,
			};
			this.db.oys.push(oy);
			this.db.lastInsertId = oy.id;
			return { success: true, meta: { last_row_id: oy.id, changes: 1 } };
		}
		if (
			sql.startsWith("UPDATE friendships SET last_oy_id = last_insert_rowid()")
		) {
			const [type, createdAt, fromUserId, startOfYesterdayNY, startOfTodayNY, userA, friendA, userB, friendB] = this
				.params as [string, number, number, number, number, number, number, number, number];
			let changes = 0;
			for (const friendship of this.db.friendships) {
				const match =
					(friendship.user_id === userA && friendship.friend_id === friendA) ||
					(friendship.user_id === userB && friendship.friend_id === friendB);
				if (match) {
					friendship.last_oy_id = this.db.lastInsertId;
					friendship.last_oy_type = type;
					const prevCreatedAt = friendship.last_oy_created_at;
					friendship.last_oy_created_at = createdAt;
					friendship.last_oy_from_user_id = fromUserId;
					if (prevCreatedAt !== null && prevCreatedAt >= startOfYesterdayNY) {
						// Keep streak start date when continuing streak.
					} else {
						friendship.streak_start_date = startOfTodayNY;
					}
					changes += 1;
				}
			}
			return { success: true, meta: { last_row_id: 0, changes } };
		}
		if (sql.startsWith("INSERT INTO notifications")) {
			const [toUserId, fromUserId, type, payload] = this.params as [
				number,
				number,
				string,
				string,
			];
			const notification: NotificationRow = {
				id: this.db.nextNotificationId++,
				to_user_id: toUserId,
				from_user_id: fromUserId,
				type,
				payload,
				created_at: nowSeconds(),
			};
			this.db.notifications.push(notification);
			this.db.lastInsertId = notification.id;
			return {
				success: true,
				meta: { last_row_id: notification.id, changes: 1 },
			};
		}
		if (sql.startsWith("INSERT INTO notification_deliveries")) {
			const [
				notificationId,
				endpoint,
				attempt,
				success,
				statusCode,
				errorMessage,
			] = this.params as [
				number,
				string,
				number,
				number,
				number | null,
				string | null,
			];
			const delivery: NotificationDeliveryRow = {
				id: this.db.nextNotificationDeliveryId++,
				notification_id: notificationId,
				endpoint,
				attempt,
				success,
				status_code: statusCode ?? null,
				error_message: errorMessage ?? null,
				created_at: nowSeconds(),
			};
			this.db.notificationDeliveries.push(delivery);
			this.db.lastInsertId = delivery.id;
			return {
				success: true,
				meta: { last_row_id: delivery.id, changes: 1 },
			};
		}
		if (sql.startsWith("DELETE FROM push_subscriptions WHERE endpoint = ?")) {
			const [endpoint] = this.params as [string];
			const before = this.db.pushSubscriptions.length;
			this.db.pushSubscriptions = this.db.pushSubscriptions.filter(
				(row) => row.endpoint !== endpoint,
			);
			return {
				success: true,
				meta: {
					last_row_id: 0,
					changes: before - this.db.pushSubscriptions.length,
				},
			};
		}
		if (sql.startsWith("DELETE FROM push_subscriptions WHERE user_id = ?")) {
			const [userId, endpoint] = this.params as [number, string];
			const before = this.db.pushSubscriptions.length;
			this.db.pushSubscriptions = this.db.pushSubscriptions.filter(
				(row) => !(row.user_id === userId && row.endpoint === endpoint),
			);
			return {
				success: true,
				meta: {
					last_row_id: 0,
					changes: before - this.db.pushSubscriptions.length,
				},
			};
		}
		if (sql.startsWith("INSERT INTO push_subscriptions")) {
			const [userId, endpoint, p256dh, auth] = this.params as [
				number,
				string,
				string,
				string,
			];
			this.db.pushSubscriptions = this.db.pushSubscriptions.filter(
				(row) => !(row.user_id === userId && row.endpoint === endpoint),
			);
			this.db.pushSubscriptions.push({
				user_id: userId,
				endpoint,
				keys_p256dh: p256dh,
				keys_auth: auth,
				created_at: nowSeconds(),
			});
			return { success: true, meta: { last_row_id: 0, changes: 1 } };
		}
		throw new Error(`Unhandled SQL run: ${sql}`);
	}

	async all() {
		const sql = normalizeSql(this.sql);
		if (sql.startsWith("SELECT users.* FROM sessions JOIN users")) {
			const [token] = this.params as [string];
			const session = this.db.sessions.find((row) => row.token === token);
			if (!session) {
				return { results: [] };
			}
			const user = this.db.users.find((row) => row.id === session.user_id);
			return { results: user ? [user] : [] };
		}
		if (
			sql.startsWith("SELECT * FROM users WHERE username COLLATE NOCASE") ||
			sql.startsWith("SELECT * FROM users WHERE username ILIKE")
		) {
			const [username] = this.params as [string];
			const user =
				this.db.users.find(
					(row) => row.username.toLowerCase() === username.toLowerCase(),
				) ?? null;
			return { results: user ? [user] : [] };
		}
		if (sql.startsWith("SELECT * FROM users WHERE id = ?")) {
			const [userId] = this.params as [number];
			const user = this.db.users.find((row) => row.id === userId) ?? null;
			return { results: user ? [user] : [] };
		}
		if (sql.startsWith("SELECT 1 FROM friendships WHERE user_id")) {
			const [userId, friendId] = this.params as [number, number];
			const exists = this.db.friendships.some(
				(row) => row.user_id === userId && row.friend_id === friendId,
			);
			return { results: exists ? [{ ok: 1 }] : [] };
		}
		if (
			sql.startsWith(
				"SELECT last_oy_created_at, streak_start_date FROM friendships WHERE user_id",
			)
		) {
			const [userId, friendId] = this.params as [number, number];
			const friendship = this.db.friendships.find(
				(row) => row.user_id === userId && row.friend_id === friendId,
			);
			return {
				results: friendship
					? [
							{
								last_oy_created_at: friendship.last_oy_created_at,
								streak_start_date: friendship.streak_start_date,
							},
						]
					: [],
			};
		}
		if (
			sql.startsWith(
				"SELECT last_oy_created_at, streak_start_date FROM last_oy_info WHERE user_id",
			)
		) {
			const [userId, friendId] = this.params as [number, number];
			const info = this.db.lastOyInfo.find(
				(row) => row.user_id === userId && row.friend_id === friendId,
			);
			return {
				results: info
					? [
							{
								last_oy_created_at: info.last_oy_created_at,
								streak_start_date: info.streak_start_date,
							},
						]
					: [],
			};
		}
		if (
			sql.startsWith(
				"SELECT id, username FROM users WHERE username COLLATE NOCASE LIKE ?",
			) ||
			sql.startsWith("SELECT id, username FROM users WHERE username ILIKE ?")
		) {
			const [pattern] = this.params as [string];
			const needle = pattern.replace(/%/g, "").toLowerCase();
			const results = this.db.users
				.filter((user) => user.username.toLowerCase().includes(needle))
				.slice(0, 20)
				.map((user) => ({ id: user.id, username: user.username }));
			return { results };
		}
		if (
			sql.startsWith("WITH current_friends AS") &&
			sql.includes("ranked_mutuals")
		) {
			const [userId, ...candidateIds] = this.params as number[];
			const friendIds = new Set(
				this.db.friendships
					.filter((row) => row.user_id === userId)
					.map((row) => row.friend_id),
			);
			const candidateSet = new Set(candidateIds);
			const mutualsMap = new Map<number, string[]>();
			for (const row of this.db.friendships) {
				if (!candidateSet.has(row.user_id)) {
					continue;
				}
				if (!friendIds.has(row.friend_id)) {
					continue;
				}
				const mutualUser = this.db.users.find((u) => u.id === row.friend_id);
				if (!mutualUser) {
					continue;
				}
				const list = mutualsMap.get(row.user_id) ?? [];
				list.push(mutualUser.username);
				mutualsMap.set(row.user_id, list);
			}
			const results = Array.from(mutualsMap.entries())
				.flatMap(([candidateId, usernames]) =>
					usernames
						.sort((a, b) => a.localeCompare(b))
						.slice(0, 5)
						.map((mutual_username) => ({
							candidate_id: candidateId,
							mutual_username,
						})),
				)
				.sort((a, b) => {
					if (a.candidate_id !== b.candidate_id) {
						return a.candidate_id - b.candidate_id;
					}
					return a.mutual_username.localeCompare(b.mutual_username);
				});
			return { results };
		}
		if (sql.startsWith("WITH current_friends AS")) {
			const [userId] = this.params as [number];
			const friendIds = new Set(
				this.db.friendships
					.filter((row) => row.user_id === userId)
					.map((row) => row.friend_id),
			);
			const mutualCounts = new Map<number, number>();
			for (const row of this.db.friendships) {
				if (row.user_id === userId) {
					continue;
				}
				if (!friendIds.has(row.friend_id)) {
					continue;
				}
				mutualCounts.set(row.user_id, (mutualCounts.get(row.user_id) ?? 0) + 1);
			}
			const results = Array.from(mutualCounts.entries())
				.map(([candidateId, mutuals]) => {
					const user = this.db.users.find((u) => u.id === candidateId);
					if (!user) {
						return null;
					}
					return { id: user.id, username: user.username, mutuals };
				})
				.filter(
					(row): row is { id: number; username: string; mutuals: number } =>
						Boolean(row),
				)
				.filter((row) => row.id !== userId && !friendIds.has(row.id))
				.sort((a, b) => {
					if (b.mutuals !== a.mutuals) {
						return b.mutuals - a.mutuals;
					}
					return a.username.localeCompare(b.username);
				})
				.slice(0, 8);
			return { results };
		}
		if (
			sql.startsWith("SELECT u.id, u.username FROM friendships f") &&
			sql.includes("INNER JOIN users u")
		) {
			const [userId] = this.params as [number];
			const results = this.db.friendships
				.filter((row) => row.user_id === userId)
				.map((row) => {
					const user = this.db.users.find((u) => u.id === row.friend_id);
					if (!user) {
						return null;
					}
					return {
						id: user.id,
						username: user.username,
					};
				})
				.filter(
					(row): row is { id: number; username: string } => Boolean(row),
				)
				.sort((a, b) => a.username.localeCompare(b.username));
			return { results };
		}
		if (sql.startsWith("SELECT friend_id, last_oy_type")) {
			const [userId] = this.params as [number];
			const results = this.db.lastOyInfo
				.filter((row) => row.user_id === userId)
				.map((row) => ({
					friend_id: row.friend_id,
					last_oy_type: row.last_oy_type,
					last_oy_created_at: row.last_oy_created_at,
					last_oy_from_user_id: row.last_oy_from_user_id,
					streak_start_date: row.streak_start_date,
				}));
			return { results };
		}
		if (sql.startsWith("SELECT u.id, u.username, f.last_oy_type")) {
			const [userId] = this.params as [number];
			const results = this.db.friendships
				.filter((row) => row.user_id === userId)
				.map((row) => {
					const user = this.db.users.find((u) => u.id === row.friend_id);
					if (!user) {
						return null;
					}
					return {
						id: user.id,
						username: user.username,
						last_oy_type: row.last_oy_type,
						last_oy_created_at: row.last_oy_created_at,
						last_oy_from_user_id: row.last_oy_from_user_id,
						streak_start_date: row.streak_start_date,
					};
				})
				.filter(
					(
						row,
					): row is {
						id: number;
						username: string;
						last_oy_type: string | null;
						last_oy_created_at: number | null;
						last_oy_from_user_id: number | null;
						streak_start_date: number | null;
					} => Boolean(row),
				)
				.sort((a, b) => a.username.localeCompare(b.username));
			return { results };
		}
		if (sql.startsWith("SELECT endpoint, keys_p256dh, keys_auth")) {
			const [userId] = this.params as [number];
			const results = this.db.pushSubscriptions
				.filter((row) => row.user_id === userId)
				.map((row) => ({
					endpoint: row.endpoint,
					keys_p256dh: row.keys_p256dh,
					keys_auth: row.keys_auth,
				}));
			return { results };
		}
		if (sql.startsWith("SELECT users.id, users.username, uls.last_seen")) {
			const [since] = this.params as [number];
			const sessionUserIds = new Set(
				this.db.sessions.map((session) => session.user_id),
			);
			const results = this.db.userLastSeen
				.filter(
					(uls) => uls.last_seen >= since && sessionUserIds.has(uls.user_id),
				)
				.sort((a, b) => b.last_seen - a.last_seen)
				.map((uls) => {
					const user = this.db.users.find((u) => u.id === uls.user_id);
					return {
						id: uls.user_id,
						username: user?.username ?? "",
						last_seen: uls.last_seen,
					};
				});
			return { results };
		}
		if (sql.startsWith("SELECT COUNT(*) as count FROM notifications")) {
			const [since] = this.params as [number];
			const count = this.db.notifications.filter(
				(row) => row.created_at >= since,
			).length;
			return { results: [{ count }] };
		}
		if (sql.startsWith("SELECT SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END)")) {
			const [since] = this.params as [number];
			const rows = this.db.notificationDeliveries.filter(
				(row) => row.created_at >= since,
			);
			const successCount = rows.filter((row) => row.success === 1).length;
			return {
				results: [{ success_count: successCount, total_count: rows.length }],
			};
		}
		if (sql.startsWith("SELECT COUNT(*) as count FROM users")) {
			return { results: [{ count: this.db.users.length }] };
		}
		if (sql.startsWith("SELECT COUNT(*) as count FROM push_subscriptions")) {
			return { results: [{ count: this.db.pushSubscriptions.length }] };
		}
		if (sql.startsWith("SELECT * FROM ( SELECT y.id")) {
			const [
				userId,
				hasCursorFlagOne,
				beforeOne,
				_beforeOneRepeat,
				beforeIdOne,
				_firstLimit,
				_userIdTwo,
				_userIdThree,
				hasCursorFlagTwo,
				_beforeTwo,
				_beforeTwoRepeat,
				_beforeIdTwo,
				_secondLimit,
				pageSize,
			] = this.params as [
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
			];

			const hasCursor = Boolean(hasCursorFlagOne || hasCursorFlagTwo);
			const before = hasCursor ? beforeOne : 0;
			const beforeId = hasCursor ? beforeIdOne : 0;

			const rows = this.db.oys
				.filter((row) => {
					const isReceived = row.to_user_id === userId;
					const isSent =
						row.from_user_id === userId && row.to_user_id !== userId;
					if (!isReceived && !isSent) {
						return false;
					}
					if (!hasCursor) {
						return true;
					}
					return (
						row.created_at < before ||
						(row.created_at === before && row.id < beforeId)
					);
				})
				.map((row) => {
					const fromUser = this.db.users.find(
						(user) => user.id === row.from_user_id,
					);
					const toUser = this.db.users.find(
						(user) => user.id === row.to_user_id,
					);
					return {
						...row,
						from_username: fromUser?.username ?? "",
						to_username: toUser?.username ?? "",
					};
				})
				.sort((a, b) => {
					if (b.created_at !== a.created_at) {
						return b.created_at - a.created_at;
					}
					return b.id - a.id;
				})
				.slice(0, pageSize);
			return { results: rows };
		}
		if (sql.startsWith("WITH inbound AS")) {
			const [
				userId,
				hasCursorFlagOne,
				beforeOne,
				_beforeOneRepeat,
				beforeIdOne,
				firstLimit,
				_userIdTwo,
				_userIdThree,
				hasCursorFlagTwo,
				_beforeTwo,
				_beforeTwoRepeat,
				_beforeIdTwo,
				secondLimit,
				pageSize,
			] = this.params as [
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
			];

			const hasCursor = Boolean(hasCursorFlagOne || hasCursorFlagTwo);
			const before = hasCursor ? beforeOne : 0;
			const beforeId = hasCursor ? beforeIdOne : 0;

			const mapRow = (row: OyRow) => {
				const fromUser = this.db.users.find(
					(user) => user.id === row.from_user_id,
				);
				const toUser = this.db.users.find((user) => user.id === row.to_user_id);
				return {
					...row,
					from_username: fromUser?.username ?? "",
					to_username: toUser?.username ?? "",
				};
			};
			const compareRows = (a: OyRow, b: OyRow) => {
				if (b.created_at !== a.created_at) {
					return b.created_at - a.created_at;
				}
				return b.id - a.id;
			};
			const isBeforeCursor = (row: OyRow) =>
				!hasCursor ||
				row.created_at < before ||
				(row.created_at === before && row.id < beforeId);

			const inbound = this.db.oys
				.filter(
					(row) => row.to_user_id === userId && isBeforeCursor(row),
				)
				.sort(compareRows)
				.slice(0, firstLimit)
				.map(mapRow);
			const outbound = this.db.oys
				.filter(
					(row) =>
						row.from_user_id === userId &&
						row.to_user_id !== userId &&
						isBeforeCursor(row),
				)
				.sort(compareRows)
				.slice(0, secondLimit)
				.map(mapRow);

			const rows = [...inbound, ...outbound]
				.sort(compareRows)
				.slice(0, pageSize);
			return { results: rows };
		}
		throw new Error(`Unhandled SQL all: ${sql}`);
	}

	async first() {
		const sql = normalizeSql(this.sql);
		// Handle INSERT ... RETURNING * for PostgreSQL
		if (
			sql.startsWith(
				"INSERT INTO users (username, phone, phone_verified) VALUES",
			) &&
			sql.includes("RETURNING *")
		) {
			const [username, phone, phoneVerified] = this.params as [
				string,
				string | null,
				number | null,
			];
			const existing = this.db.users.find(
				(user) => user.username.toLowerCase() === username.toLowerCase(),
			);
			if (existing) {
				return null;
			}
			return seedUser(this.db, {
				username,
				phone: phone ?? null,
				phoneVerified: phoneVerified ?? 0,
			});
		}
		if (
			sql.startsWith("INSERT INTO users (username) VALUES") &&
			sql.includes("RETURNING *")
		) {
			const [username] = this.params as [string];
			const existing = this.db.users.find(
				(user) => user.username.toLowerCase() === username.toLowerCase(),
			);
			if (existing) {
				return null;
			}
			return seedUser(this.db, { username });
		}
		if (
			sql.startsWith("UPDATE users SET phone = ?, phone_verified = ?") &&
			sql.includes("RETURNING *")
		) {
			const [phone, phoneVerified, userId] = this.params as [
				string,
				number,
				number,
			];
			const user = this.db.users.find((row) => row.id === userId);
			if (!user) {
				return null;
			}
			user.phone = phone;
			user.phone_verified = phoneVerified;
			return user;
		}
		// Handle INSERT ... RETURNING id for PostgreSQL
		if (
			sql.startsWith(
				"INSERT INTO users (username, phone, phone_verified) VALUES",
			) &&
			sql.includes("RETURNING id")
		) {
			const [username, phone, phoneVerified] = this.params as [
				string,
				string | null,
				number | null,
			];
			const existing = this.db.users.find(
				(user) => user.username.toLowerCase() === username.toLowerCase(),
			);
			if (existing) {
				return null;
			}
			const user = seedUser(this.db, {
				username,
				phone: phone ?? null,
				phoneVerified: phoneVerified ?? 0,
			});
			return { id: user.id };
		}
		if (
			sql.startsWith(
				"INSERT INTO oys (from_user_id, to_user_id, type, payload, created_at)",
			) &&
			sql.includes("RETURNING id")
		) {
			const [fromUserId, toUserId, type, payload, createdAt] = this.params as [
				number,
				number,
				string,
				string | null,
				number,
			];
			const oy: OyRow = {
				id: this.db.nextOyId++,
				from_user_id: fromUserId,
				to_user_id: toUserId,
				type,
				payload,
				created_at: createdAt,
			};
			this.db.oys.push(oy);
			this.db.lastInsertId = oy.id;
			return { id: oy.id };
		}
		if (
			sql.startsWith("INSERT INTO users (username) VALUES") &&
			sql.includes("RETURNING id")
		) {
			const [username] = this.params as [string];
			const existing = this.db.users.find(
				(user) => user.username.toLowerCase() === username.toLowerCase(),
			);
			if (existing) {
				return null;
			}
			const user = seedUser(this.db, { username });
			return { id: user.id };
		}
		// Handle complex CTE for oys insertion
		if (sql.startsWith("WITH inserted AS ( INSERT INTO oys")) {
			const [
				fromUserId,
				toUserId,
				type,
				payload,
				createdAt,
				_type2,
				_createdAt2,
				_fromUserId2,
				startOfYesterdayNY,
				startOfTodayNY,
				userA,
				friendA,
				userB,
				friendB,
			] = this.params as [
				number,
				number,
				string,
				string | null,
				number,
				string,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
			];
			// Insert the oy
			const oy: OyRow = {
				id: this.db.nextOyId++,
				from_user_id: fromUserId,
				to_user_id: toUserId,
				type,
				payload,
				created_at: createdAt,
			};
			this.db.oys.push(oy);
			this.db.lastInsertId = oy.id;
			// Update friendships
			for (const friendship of this.db.friendships) {
				const match =
					(friendship.user_id === userA && friendship.friend_id === friendA) ||
					(friendship.user_id === userB && friendship.friend_id === friendB);
				if (match) {
					friendship.last_oy_id = oy.id;
					friendship.last_oy_type = type;
					const prevCreatedAt = friendship.last_oy_created_at;
					friendship.last_oy_created_at = createdAt;
					friendship.last_oy_from_user_id = fromUserId;
					// Update streak_start_date based on whether last oy was recent
					if (prevCreatedAt !== null && prevCreatedAt >= startOfYesterdayNY) {
						// Keep existing streak_start_date
					} else {
						friendship.streak_start_date = startOfTodayNY;
					}
				}
			}
			return { id: oy.id };
		}
		// Handle INSERT INTO notifications ... RETURNING id
		if (
			sql.startsWith("INSERT INTO notifications") &&
			sql.includes("RETURNING id")
		) {
			const [toUserId, fromUserId, type, payload] = this.params as [
				number,
				number,
				string,
				string,
			];
			const notification: NotificationRow = {
				id: this.db.nextNotificationId++,
				to_user_id: toUserId,
				from_user_id: fromUserId,
				type,
				payload,
				created_at: nowSeconds(),
			};
			this.db.notifications.push(notification);
			return { id: notification.id };
		}
		if (sql.startsWith("SELECT users.* FROM sessions JOIN users")) {
			const [token] = this.params as [string];
			const session = this.db.sessions.find((row) => row.token === token);
			if (!session) {
				return null;
			}
			return this.db.users.find((user) => user.id === session.user_id) ?? null;
		}
		if (
			sql.startsWith("SELECT * FROM users WHERE username COLLATE NOCASE") ||
			sql.startsWith("SELECT * FROM users WHERE username ILIKE")
		) {
			const [username] = this.params as [string];
			return (
				this.db.users.find(
					(user) => user.username.toLowerCase() === username.toLowerCase(),
				) ?? null
			);
		}
		if (sql.startsWith("SELECT * FROM users WHERE id = ?")) {
			const [userId] = this.params as [number];
			return this.db.users.find((user) => user.id === userId) ?? null;
		}
		if (sql.startsWith("SELECT 1 FROM friendships WHERE user_id")) {
			const [userId, friendId] = this.params as [number, number];
			const exists = this.db.friendships.some(
				(row) => row.user_id === userId && row.friend_id === friendId,
			);
			return exists ? { ok: 1 } : null;
		}
		if (
			sql.startsWith(
				"SELECT last_oy_created_at, streak_start_date FROM friendships WHERE user_id",
			)
		) {
			const [userId, friendId] = this.params as [number, number];
			const friendship = this.db.friendships.find(
				(row) => row.user_id === userId && row.friend_id === friendId,
			);
			return friendship
				? {
						last_oy_created_at: friendship.last_oy_created_at,
						streak_start_date: friendship.streak_start_date,
					}
				: null;
		}
		if (
			sql.startsWith(
				"SELECT last_oy_created_at, streak_start_date FROM last_oy_info WHERE user_id",
			)
		) {
			const [userId, friendId] = this.params as [number, number];
			const info = this.db.lastOyInfo.find(
				(row) => row.user_id === userId && row.friend_id === friendId,
			);
			return info
				? {
						last_oy_created_at: info.last_oy_created_at,
						streak_start_date: info.streak_start_date,
					}
				: null;
		}
		throw new Error(`Unhandled SQL first: ${sql}`);
	}
}

export function createExecutionContext() {
	const waitUntilPromises: Promise<unknown>[] = [];
	const ctx: ExecutionContext & { waitUntilPromises: Promise<unknown>[] } = {
		waitUntil(promise) {
			waitUntilPromises.push(promise);
		},
		passThroughOnException() {},
		props: {},
		waitUntilPromises,
	};
	return ctx;
}

export function createTestEnv() {
	const db = new FakeD1Database();
	const kv = new FakeKV();
	const env = {
		TEST_DB: new FakePgClient(db),
		OY2: kv,
		VAPID_PUBLIC_KEY: "test-public",
		VAPID_PRIVATE_KEY: "test-private",
		VAPID_SUBJECT: "mailto:test@example.com",
		TEXTBELT_API_KEY: "test-key",
	};
	return { env, db, kv };
}

export function seedUser(
	db: FakeD1Database,
	{
		username,
		phone = null,
		phoneVerified = 0,
		admin = 0,
		lastSeen = null,
	}: {
		username: string;
		phone?: string | null;
		phoneVerified?: number;
		admin?: number;
		lastSeen?: number | null;
	},
) {
	const user: UserRow = {
		id: db.nextUserId++,
		username,
		created_at: nowSeconds(),
		phone,
		phone_verified: phoneVerified,
		admin,
	};
	db.users.push(user);
	db.lastInsertId = user.id;
	if (lastSeen !== null) {
		db.userLastSeen.push({ user_id: user.id, last_seen: lastSeen });
	}
	return user;
}

export function seedSession(db: FakeD1Database, userId: number, token: string) {
	db.sessions.push({
		token,
		user_id: userId,
		created_at: nowSeconds(),
	});
}

export function seedFriendship(
	db: FakeD1Database,
	userId: number,
	friendId: number,
	{
		lastOyCreatedAt = null,
		streakStartDate = null,
	}: { lastOyCreatedAt?: number | null; streakStartDate?: number | null } = {},
) {
	db.friendships.push({
		user_id: userId,
		friend_id: friendId,
		created_at: nowSeconds(),
		last_oy_id: null,
		last_oy_type: null,
		last_oy_created_at: lastOyCreatedAt,
		last_oy_from_user_id: null,
		streak: 1,
		streak_start_date: streakStartDate,
	});
}

export function seedLastOyInfo(
	db: FakeD1Database,
	{
		userId,
		friendId,
		lastOyId = null,
		lastOyType = null,
		lastOyCreatedAt = null,
		lastOyFromUserId = null,
		streak = 1,
		streakStartDate = null,
	}: {
		userId: number;
		friendId: number;
		lastOyId?: number | null;
		lastOyType?: string | null;
		lastOyCreatedAt?: number | null;
		lastOyFromUserId?: number | null;
		streak?: number;
		streakStartDate?: number | null;
	},
) {
	db.lastOyInfo.push({
		user_id: userId,
		friend_id: friendId,
		last_oy_id: lastOyId,
		last_oy_type: lastOyType,
		last_oy_created_at: lastOyCreatedAt,
		last_oy_from_user_id: lastOyFromUserId,
		streak,
		streak_start_date: streakStartDate,
	});
}

export function seedOy(
	db: FakeD1Database,
	{
		fromUserId,
		toUserId,
		type,
		payload = null,
		createdAt = nowSeconds(),
	}: {
		fromUserId: number;
		toUserId: number;
		type: string;
		payload?: string | null;
		createdAt?: number;
	},
) {
	const oy: OyRow = {
		id: db.nextOyId++,
		from_user_id: fromUserId,
		to_user_id: toUserId,
		type,
		payload,
		created_at: createdAt,
	};
	db.oys.push(oy);
	db.lastInsertId = oy.id;
	return oy;
}

export function seedNotificationDelivery(
	db: FakeD1Database,
	{
		notificationId,
		endpoint,
		attempt,
		success,
		statusCode = null,
		errorMessage = null,
		createdAt = nowSeconds(),
	}: {
		notificationId: number;
		endpoint: string;
		attempt: number;
		success: number;
		statusCode?: number | null;
		errorMessage?: string | null;
		createdAt?: number;
	},
) {
	db.notificationDeliveries.push({
		id: db.nextNotificationDeliveryId++,
		notification_id: notificationId,
		endpoint,
		attempt,
		success,
		status_code: statusCode,
		error_message: errorMessage,
		created_at: createdAt,
	});
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function getStartOfDayNY(date: Date): number {
	const nyDateStr = date.toLocaleDateString("en-US", {
		timeZone: "America/New_York",
	});
	const [month, day, year] = nyDateStr.split("/").map(Number);
	const nyMidnight = new Date(
		date.toLocaleString("en-US", { timeZone: "America/New_York" }),
	);
	nyMidnight.setFullYear(year, month - 1, day);
	nyMidnight.setHours(0, 0, 0, 0);
	const offset =
		date.getTime() -
		new Date(
			date.toLocaleString("en-US", { timeZone: "America/New_York" }),
		).getTime();
	return Math.floor((nyMidnight.getTime() + offset) / 1000);
}

export function getStreakDateBoundaries() {
	const now = new Date();
	const startOfTodayNY = getStartOfDayNY(now);
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const startOfYesterdayNY = getStartOfDayNY(yesterday);
	return { startOfTodayNY, startOfYesterdayNY };
}
