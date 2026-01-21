import { Client } from "pg";
import { compressData } from "./compress";
import { exportAllTables, TABLES_TO_BACKUP, type TableExport } from "./export";
import { generateBackupKey, rotateBackups } from "./rotation";

const BACKUP_VERSION = "1.0.0";

type Env = {
	HYPERDRIVE: Hyperdrive;
	BACKUP_BUCKET: R2Bucket;
};

type BackupManifest = {
	timestamp: string;
	timestampUnix: number;
	version: string;
	compressed: boolean;
	totalRows: number;
	tables: TableExport[];
};

async function runBackup(env: Env) {
	const startTime = Date.now();

	const client = new Client({
		connectionString: env.HYPERDRIVE.connectionString,
	});

	try {
		await client.connect();

		console.log("Starting database export...");
		const tableExports = await exportAllTables(client);

		for (const t of tableExports) {
			console.log(`  ${t.tableName}: ${t.rowCount} rows`);
		}

		const totalRows = tableExports.reduce((sum, t) => sum + t.rowCount, 0);
		console.log(
			`Exported ${totalRows} rows from ${tableExports.length} tables`,
		);

		const now = new Date();
		const manifest: BackupManifest = {
			timestamp: now.toISOString(),
			timestampUnix: Math.floor(now.getTime() / 1000),
			version: BACKUP_VERSION,
			compressed: true,
			totalRows,
			tables: tableExports,
		};

		const jsonData = JSON.stringify(manifest);
		console.log(`JSON size: ${jsonData.length} bytes`);

		const compressedData = await compressData(jsonData);
		console.log(`Compressed size: ${compressedData.byteLength} bytes`);

		const backupKey = generateBackupKey(now);

		await env.BACKUP_BUCKET.put(backupKey, compressedData, {
			httpMetadata: {
				contentType: "application/gzip",
				contentEncoding: "gzip",
			},
			customMetadata: {
				backupTimestamp: manifest.timestamp,
				totalRows: String(totalRows),
				version: BACKUP_VERSION,
				tables: TABLES_TO_BACKUP.join(","),
			},
		});

		console.log(`Backup uploaded to ${backupKey}`);

		console.log("Running backup rotation...");
		const rotationResult = await rotateBackups(env.BACKUP_BUCKET, now);
		console.log(
			`Rotation: ${rotationResult.deleted.length} deleted, ${rotationResult.promoted.length} promoted, ${rotationResult.kept.length} kept`,
		);

		if (rotationResult.errors.length > 0) {
			console.warn("Rotation errors:", rotationResult.errors);
		}

		const durationMs = Date.now() - startTime;
		console.log(`Backup completed in ${durationMs}ms`);

		return {
			success: true,
			key: backupKey,
			stats: {
				tables: tableExports.length,
				totalRows,
				compressedSize: compressedData.byteLength,
				durationMs,
			},
			rotation: rotationResult,
		};
	} catch (error) {
		console.error("Backup failed:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await client.end();
	}
}

export default {
	async scheduled(
		event: ScheduledEvent,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		console.log(`Scheduled backup triggered at ${new Date().toISOString()}`);
		console.log(`Cron pattern: ${event.cron}`);

		const result = await runBackup(env);

		if (result.success) {
			console.log("Backup completed successfully:", result);
		} else {
			console.error("Backup failed:", result.error);
			throw new Error(`Backup failed: ${result.error}`);
		}
	},
};
