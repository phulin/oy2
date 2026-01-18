#!/usr/bin/env npx tsx
/**
 * One-time script to compute initial streaks from the yos table.
 *
 * For each friendship, walks backwards in days from yesterday to find how many
 * consecutive days have oys. Adds 1 if there's also an oy today.
 *
 * Usage:
 *   npx tsx scripts/compute-initial-streaks.ts --dry-run
 *   npx tsx scripts/compute-initial-streaks.ts
 *   npx tsx scripts/compute-initial-streaks.ts --remote --dry-run
 *   npx tsx scripts/compute-initial-streaks.ts --remote
 */

import { execSync } from "node:child_process";

const DRY_RUN = process.argv.includes("--dry-run");
const REMOTE = process.argv.includes("--remote");
const DB_NAME = "oy2-db";
const UPDATE_BATCH_SIZE = 50;

function runD1Query(sql: string): string {
	const remoteFlag = REMOTE ? "--remote" : "--local";
	const cmd = `npx wrangler d1 execute ${DB_NAME} ${remoteFlag} --json --command="${sql.replace(/"/g, '\\"')}"`;
	try {
		return execSync(cmd, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (err) {
		const error = err as { stderr?: string; stdout?: string };
		console.error("D1 query failed:", error.stderr || error.stdout);
		throw err;
	}
}

function parseD1Result(output: string): unknown[] {
	const parsed = JSON.parse(output);
	if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].results) {
		return parsed[0].results;
	}
	return [];
}

// Get start of day in NY timezone for a given date
function getStartOfDayNY(date: Date): number {
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

// Get NY date string (YYYY-MM-DD) for a unix timestamp
function getNYDateString(timestamp: number): string {
	const date = new Date(timestamp * 1000);
	return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // en-CA gives YYYY-MM-DD
}

// Create a consistent key for a pair of users (order-independent for lookups)
function pairKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`;
}

type Friendship = {
	user_id: number;
	friend_id: number;
};

type Yo = {
	from_user_id: number;
	to_user_id: number;
	created_at: number;
};

async function main() {
	console.log(
		`Computing initial streaks (${DRY_RUN ? "DRY RUN" : "LIVE"}, ${REMOTE ? "REMOTE" : "LOCAL"})...\n`,
	);

	// Get all friendships in one query
	console.log("Fetching friendships...");
	const friendshipsOutput = runD1Query(
		"SELECT user_id, friend_id FROM friendships",
	);
	const friendships = parseD1Result(friendshipsOutput) as Friendship[];
	console.log(`Found ${friendships.length} friendships`);

	// Get all yos in one query
	console.log("Fetching all yos...");
	const yosOutput = runD1Query(
		"SELECT from_user_id, to_user_id, created_at FROM yos",
	);
	const allYos = parseD1Result(yosOutput) as Yo[];
	console.log(`Found ${allYos.length} yos`);

	// Build a map of user pair -> set of dates
	console.log("Building date maps...");
	const pairDates = new Map<string, Set<string>>();
	for (const yo of allYos) {
		const key = pairKey(yo.from_user_id, yo.to_user_id);
		let dates = pairDates.get(key);
		if (!dates) {
			dates = new Set();
			pairDates.set(key, dates);
		}
		const dateStr = getNYDateString(yo.created_at);
		dates.add(dateStr);
	}

	// Get current NY date boundaries
	const now = new Date();
	const startOfTodayNY = getStartOfDayNY(now);
	const todayStr = getNYDateString(startOfTodayNY);

	// Compute streaks for each friendship
	console.log("Computing streaks...");
	const updates: { userId: number; friendId: number; streak: number }[] = [];

	for (const friendship of friendships) {
		const { user_id: userId, friend_id: friendId } = friendship;
		const key = pairKey(userId, friendId);
		const dates = pairDates.get(key);

		if (!dates || dates.size === 0) {
			updates.push({ userId, friendId, streak: 0 });
			continue;
		}

		// Check if there's a yo today
		const hasYoToday = dates.has(todayStr);

		// Walk backwards from yesterday counting consecutive days
		let streak = 0;
		let checkDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // yesterday

		while (true) {
			const dateStr = getNYDateString(getStartOfDayNY(checkDate));
			if (dates.has(dateStr)) {
				streak++;
				checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
			} else {
				break;
			}
		}

		// Add 1 if there's a yo today
		if (hasYoToday) {
			streak++;
		}

		updates.push({ userId, friendId, streak });
	}

	// Generate and execute updates
	console.log(`\nGenerated ${updates.length} updates:\n`);

	let nonZeroCount = 0;
	for (const update of updates) {
		if (update.streak !== 0) {
			nonZeroCount++;
			console.log(
				`  (${update.userId}, ${update.friendId}) -> streak = ${update.streak}`,
			);
		}
	}
	console.log(
		`  ... and ${updates.length - nonZeroCount} friendships with streak = 0 (no recent oys)\n`,
	);

	if (DRY_RUN) {
		console.log(
			"DRY RUN - no changes made. Run without --dry-run to apply updates.\n",
		);
		return;
	}

	// Build and execute batch update
	console.log("Applying updates...");

	// Group updates by streak value for more efficient batch updates
	const updatesByStreak = new Map<
		number,
		{ userId: number; friendId: number }[]
	>();
	for (const update of updates) {
		let pairs = updatesByStreak.get(update.streak);
		if (!pairs) {
			pairs = [];
			updatesByStreak.set(update.streak, pairs);
		}
		pairs.push({ userId: update.userId, friendId: update.friendId });
	}

	for (const [streak, pairs] of updatesByStreak) {
		for (let i = 0; i < pairs.length; i += UPDATE_BATCH_SIZE) {
			const batch = pairs.slice(i, i + UPDATE_BATCH_SIZE);
			const conditions = batch
				.map((p) => `(user_id = ${p.userId} AND friend_id = ${p.friendId})`)
				.join(" OR ");
			const sql = `UPDATE friendships SET streak = ${streak} WHERE ${conditions}`;
			runD1Query(sql);
			console.log(
				`  Updated ${batch.length} friendships to streak = ${streak}`,
			);
		}
	}

	console.log("\nDone! All streaks computed and updated.\n");
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
