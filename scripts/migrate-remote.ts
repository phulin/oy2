/**
 * Deploys migration worker, runs it, and cleans up automatically.
 * Reads migrations from migrations-pg/ and embeds them into the worker.
 * Usage: yarn db:migrate:remote
 */

import { spawn } from "node:child_process";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const run = (cmd: string, args: string[]): Promise<string> => {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		proc.stdout?.on("data", (data) => {
			stdout += data;
			process.stdout.write(data);
		});
		proc.stderr?.on("data", (data) => {
			stderr += data;
			process.stderr.write(data);
		});
		proc.on("close", (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`Command failed with code ${code}: ${stderr}`));
		});
	});
};

async function loadMigrations(): Promise<Record<string, string>> {
	const migrationsDir = join(import.meta.dirname, "..", "migrations-pg");
	const files = (await readdir(migrationsDir))
		.filter((f) => f.endsWith(".sql"))
		.sort();

	const migrations: Record<string, string> = {};
	for (const file of files) {
		migrations[file] = await readFile(join(migrationsDir, file), "utf-8");
	}
	return migrations;
}

function generateWorkerCode(migrations: Record<string, string>): string {
	const migrationsJson = JSON.stringify(migrations, null, 2);

	return `
import { Client } from "pg";

interface Env {
	HYPERDRIVE: { connectionString: string };
}

const migrations: Record<string, string> = ${migrationsJson};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });

		try {
			await client.connect();

			await client.query(\`
				CREATE TABLE IF NOT EXISTS _migrations (
					id SERIAL PRIMARY KEY,
					name VARCHAR(255) NOT NULL UNIQUE,
					applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				)
			\`);

			const { rows: applied } = await client.query<{ name: string }>(
				"SELECT name FROM _migrations ORDER BY name"
			);
			const appliedSet = new Set(applied.map((r) => r.name));

			const results: string[] = [];
			const migrationNames = Object.keys(migrations).sort();

			for (const name of migrationNames) {
				if (appliedSet.has(name)) {
					results.push(\`Skipped \${name} (already applied)\`);
					continue;
				}

				await client.query("BEGIN");
				try {
					await client.query(migrations[name]);
					await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
					await client.query("COMMIT");
					results.push(\`Applied \${name}\`);
				} catch (err) {
					await client.query("ROLLBACK");
					throw err;
				}
			}

			results.push("All migrations complete");
			return new Response(results.join("\\n"), {
				headers: { "Content-Type": "text/plain" }
			});

		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return new Response(\`Migration failed: \${message}\`, { status: 500 });
		} finally {
			await client.end();
		}
	},
};
`;
}

async function main() {
	const workerPath = join(import.meta.dirname, "migrate-worker.ts");

	console.log("📂 Loading migrations from migrations-pg/...\n");
	const migrations = await loadMigrations();
	console.log(`Found ${Object.keys(migrations).length} migrations\n`);

	console.log("📝 Generating worker code...\n");
	const workerCode = generateWorkerCode(migrations);
	await writeFile(workerPath, workerCode);

	try {
		console.log("🚀 Deploying migration worker...\n");
		await run("npx", [
			"wrangler",
			"deploy",
			"--config",
			"scripts/migrate-wrangler.toml",
		]);

		console.log("\n📦 Running migrations...\n");
		const response = await fetch("https://oy2-migrate.oyme.workers.dev");
		const result = await response.text();
		console.log(result);

		if (!response.ok) {
			console.error("\n❌ Migration failed!");
			process.exitCode = 1;
		} else {
			console.log("\n✅ Migrations complete!");
		}

		console.log("\n🧹 Cleaning up worker...\n");
		await run("npx", [
			"wrangler",
			"delete",
			"--config",
			"scripts/migrate-wrangler.toml",
			"--force",
		]);
	} finally {
		// Clean up generated worker file
		await unlink(workerPath).catch(() => {});
	}

	console.log("\n🎉 Done!");
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
