#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import Database from "better-sqlite3";
import { Client } from "pg";

type UserRow = {
	id: number;
	username: string;
	created_at: number;
	phone: string | null;
	phone_verified: number;
	admin: number;
	last_seen: number | null;
};

type FriendshipRow = {
	user_id: number;
	friend_id: number;
	created_at: number;
	last_yo_id: number | null;
	last_yo_type: string | null;
	last_yo_created_at: number | null;
	last_yo_from_user_id: number | null;
	streak_start_date: number | null;
};

type OyRow = {
	id: number;
	from_user_id: number;
	to_user_id: number;
	created_at: number;
	type: string | null;
	payload: string | null;
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

const REMOTE = process.argv.includes("--remote");
const TRUNCATE = process.argv.includes("--truncate");
const DB_NAME = getArgValue("--db-name") ?? "oy2-db";
const EXPORT_PATH = getArgValue("--export-path") ?? "data/oy2-export.db";
const SQLITE_PATH = getArgValue("--sqlite-path") ?? "data/oy2-export.sqlite";
const BATCH_SIZE = Number(getArgValue("--batch-size") ?? "500");

function getArgValue(flag: string): string | null {
	const flagIndex = process.argv.indexOf(flag);
	if (flagIndex === -1) {
		return null;
	}
	return process.argv[flagIndex + 1] ?? null;
}

function runCommand(command: string): string {
	return execSync(command, {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function exportD1Database() {
	const remoteFlag = REMOTE ? "--remote" : "--local";
	console.log(
		`Exporting D1 (${REMOTE ? "remote" : "local"}) to ${EXPORT_PATH}...`,
	);
	runCommand(
		`npx wrangler d1 export ${DB_NAME} ${remoteFlag} --output ${EXPORT_PATH}`,
	);
}

async function loadSqliteExport() {
	console.log(`Loading export into SQLite db ${SQLITE_PATH}...`);
	await rm(SQLITE_PATH, { force: true });
	const exportSql = await readFile(EXPORT_PATH, "utf-8");
	const db = new Database(SQLITE_PATH);
	try {
		db.exec(exportSql);
	} finally {
		db.close();
	}
}

function runSqliteQuery(sql: string): unknown[] {
	const db = new Database(SQLITE_PATH, { readonly: true });
	try {
		return db.prepare(sql).all();
	} finally {
		db.close();
	}
}

async function insertRows<T>(
	client: Client,
	table: string,
	columns: string[],
	rows: T[],
	getValues: (row: T) => unknown[],
) {
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);
		if (batch.length === 0) {
			continue;
		}
		const values: unknown[] = [];
		const placeholders = batch
			.map((row, rowIndex) => {
				const rowValues = getValues(row);
				values.push(...rowValues);
				const offset = rowIndex * columns.length;
				const rowPlaceholders = columns
					.map((_, columnIndex) => `$${offset + columnIndex + 1}`)
					.join(", ");
				return `(${rowPlaceholders})`;
			})
			.join(", ");

		await client.query(
			`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`,
			values,
		);
	}
}

async function resetSequence(client: Client, table: string, column: string) {
	await client.query(
		`SELECT setval(pg_get_serial_sequence('${table}', '${column}'), COALESCE((SELECT MAX(${column}) FROM ${table}), 1), true)`,
	);
}

async function truncateDestination(client: Client) {
	await client.query(`
		TRUNCATE TABLE
			notification_deliveries,
			notifications,
			push_subscriptions,
			sessions,
			last_oy_info,
			oys,
			friendships,
			user_last_seen,
			users
		CASCADE
	`);
}

async function main() {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error("DATABASE_URL is required for Supabase/Postgres.");
		process.exit(1);
	}

	exportD1Database();
	await loadSqliteExport();

	console.log("Fetching SQLite data...");
	const users = runSqliteQuery(
		"SELECT id, username, created_at, phone, phone_verified, admin, last_seen FROM users ORDER BY id",
	) as UserRow[];
	const friendships = runSqliteQuery(
		"SELECT user_id, friend_id, created_at, last_yo_id, last_yo_type, last_yo_created_at, last_yo_from_user_id, streak_start_date FROM friendships",
	) as FriendshipRow[];
	const oys = runSqliteQuery(
		"SELECT id, from_user_id, to_user_id, created_at, type, payload FROM yos ORDER BY id",
	) as OyRow[];
	const pushSubscriptions = runSqliteQuery(
		"SELECT user_id, endpoint, keys_p256dh, keys_auth, created_at FROM push_subscriptions",
	) as PushSubscriptionRow[];
	const notifications = runSqliteQuery(
		"SELECT id, to_user_id, from_user_id, type, payload, created_at FROM notifications ORDER BY id",
	) as NotificationRow[];
	const notificationDeliveries = runSqliteQuery(
		"SELECT id, notification_id, endpoint, attempt, success, status_code, error_message, created_at FROM notification_deliveries ORDER BY id",
	) as NotificationDeliveryRow[];
	const sessions = runSqliteQuery(
		"SELECT token, user_id, created_at FROM sessions",
	) as SessionRow[];

	const client = new Client({ connectionString: databaseUrl });
	await client.connect();

	try {
		if (TRUNCATE) {
			console.log("Truncating destination tables...");
			await truncateDestination(client);
		}

		console.log("Inserting users...");
		await insertRows(
			client,
			"users",
			["id", "username", "created_at", "phone", "phone_verified", "admin"],
			users,
			(user) => [
				user.id,
				user.username,
				user.created_at,
				user.phone,
				user.phone_verified,
				user.admin,
			],
		);

		console.log("Inserting user last seen...");
		const userLastSeen = users
			.filter((user) => user.last_seen !== null)
			.map((user) => ({ user_id: user.id, last_seen: user.last_seen }));
		await insertRows(
			client,
			"user_last_seen",
			["user_id", "last_seen"],
			userLastSeen,
			(row) => [row.user_id, row.last_seen],
		);

		console.log("Inserting friendships...");
		await insertRows(
			client,
			"friendships",
			["user_id", "friend_id", "created_at"],
			friendships,
			(row) => [row.user_id, row.friend_id, row.created_at],
		);

		console.log("Inserting last oy info...");
		const lastOyRows = friendships.filter((row) => row.last_yo_id !== null);
		await insertRows(
			client,
			"last_oy_info",
			[
				"user_id",
				"friend_id",
				"last_oy_id",
				"last_oy_type",
				"last_oy_created_at",
				"last_oy_from_user_id",
				"streak_start_date",
			],
			lastOyRows,
			(row) => [
				row.user_id,
				row.friend_id,
				row.last_yo_id,
				row.last_yo_type,
				row.last_yo_created_at,
				row.last_yo_from_user_id,
				row.streak_start_date,
			],
		);

		console.log("Inserting oys...");
		await insertRows(
			client,
			"oys",
			["id", "from_user_id", "to_user_id", "created_at", "type", "payload"],
			oys,
			(row) => [
				row.id,
				row.from_user_id,
				row.to_user_id,
				row.created_at,
				row.type ?? "oy",
				row.payload,
			],
		);

		console.log("Inserting push subscriptions...");
		await insertRows(
			client,
			"push_subscriptions",
			["user_id", "endpoint", "keys_p256dh", "keys_auth", "created_at"],
			pushSubscriptions,
			(row) => [
				row.user_id,
				row.endpoint,
				row.keys_p256dh,
				row.keys_auth,
				row.created_at,
			],
		);

		console.log("Inserting notifications...");
		await insertRows(
			client,
			"notifications",
			["id", "to_user_id", "from_user_id", "type", "payload", "created_at"],
			notifications,
			(row) => [
				row.id,
				row.to_user_id,
				row.from_user_id,
				row.type,
				row.payload,
				row.created_at,
			],
		);

		console.log("Inserting notification deliveries...");
		await insertRows(
			client,
			"notification_deliveries",
			[
				"id",
				"notification_id",
				"endpoint",
				"attempt",
				"success",
				"status_code",
				"error_message",
				"created_at",
			],
			notificationDeliveries,
			(row) => [
				row.id,
				row.notification_id,
				row.endpoint,
				row.attempt,
				row.success,
				row.status_code,
				row.error_message,
				row.created_at,
			],
		);

		console.log("Inserting sessions...");
		await insertRows(
			client,
			"sessions",
			["token", "user_id", "created_at"],
			sessions,
			(row) => [row.token, row.user_id, row.created_at],
		);

		console.log("Resetting sequences...");
		await resetSequence(client, "users", "id");
		await resetSequence(client, "oys", "id");
		await resetSequence(client, "notifications", "id");
		await resetSequence(client, "notification_deliveries", "id");

		console.log("Migration complete.");
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
