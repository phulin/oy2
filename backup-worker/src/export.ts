import type { Client } from "pg";

export type TableExport = {
	tableName: string;
	columns: string[];
	rows: unknown[];
	rowCount: number;
};

const TABLES_TO_BACKUP = [
	"users",
	"user_last_seen",
	"friendships",
	"last_oy_info",
	"oys",
	"push_subscriptions",
	"notifications",
	"notification_deliveries",
	"sessions",
	"passkeys",
] as const;

const BATCH_SIZE = 10000;

async function exportTable(
	db: Client,
	tableName: string,
): Promise<TableExport> {
	const columnsResult = await db.query<{ column_name: string }>(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_name = $1
		 ORDER BY ordinal_position`,
		[tableName],
	);
	const columns = columnsResult.rows.map((r) => r.column_name);

	const countResult = await db.query<{ count: string }>(
		`SELECT COUNT(*) as count FROM "${tableName}"`,
	);
	const totalCount = parseInt(countResult.rows[0]?.count ?? "0", 10);

	if (totalCount <= BATCH_SIZE) {
		const dataResult = await db.query(
			`SELECT * FROM "${tableName}" ORDER BY 1`,
		);
		return {
			tableName,
			columns,
			rows: dataResult.rows,
			rowCount: dataResult.rows.length,
		};
	}

	const allRows: unknown[] = [];
	let offset = 0;

	while (offset < totalCount) {
		const batchResult = await db.query(
			`SELECT * FROM "${tableName}" ORDER BY 1 LIMIT $1 OFFSET $2`,
			[BATCH_SIZE, offset],
		);
		allRows.push(...batchResult.rows);
		offset += BATCH_SIZE;
	}

	return {
		tableName,
		columns,
		rows: allRows,
		rowCount: allRows.length,
	};
}

export async function exportAllTables(db: Client): Promise<TableExport[]> {
	const exports = await Promise.all(
		TABLES_TO_BACKUP.map((table) =>
			exportTable(db, table).catch((err) => {
				console.error(`Failed to export table ${table}:`, err);
				return {
					tableName: table,
					columns: [],
					rows: [],
					rowCount: 0,
				} as TableExport;
			}),
		),
	);

	return exports;
}

export { TABLES_TO_BACKUP };
