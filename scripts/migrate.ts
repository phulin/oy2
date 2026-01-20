import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

async function migrate() {
	// Use DATABASE_URL if set, otherwise connect via Unix socket to local 'oy2' db
	const client = process.env.DATABASE_URL
		? new Client({ connectionString: process.env.DATABASE_URL })
		: new Client({ database: "oy2" });
	await client.connect();

	try {
		// Create migrations tracking table if it doesn't exist
		await client.query(`
			CREATE TABLE IF NOT EXISTS _migrations (
				id SERIAL PRIMARY KEY,
				name VARCHAR(255) NOT NULL UNIQUE,
				applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Get list of applied migrations
		const { rows: applied } = await client.query<{ name: string }>(
			"SELECT name FROM _migrations ORDER BY name",
		);
		const appliedSet = new Set(applied.map((r) => r.name));

		// Read migration files
		const migrationsDir = join(import.meta.dirname, "..", "migrations-pg");
		const files = (await readdir(migrationsDir))
			.filter((f) => f.endsWith(".sql"))
			.sort();

		// Apply pending migrations
		for (const file of files) {
			if (appliedSet.has(file)) {
				console.log(`Skipping ${file} (already applied)`);
				continue;
			}

			console.log(`Applying ${file}...`);
			const sql = await readFile(join(migrationsDir, file), "utf-8");

			await client.query("BEGIN");
			try {
				await client.query(sql);
				await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
					file,
				]);
				await client.query("COMMIT");
				console.log(`Applied ${file}`);
			} catch (err) {
				await client.query("ROLLBACK");
				throw err;
			}
		}

		console.log("All migrations applied successfully");
	} finally {
		await client.end();
	}
}

migrate().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
