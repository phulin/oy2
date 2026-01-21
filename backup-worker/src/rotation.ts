const DAILY_RETENTION_DAYS = 30;

type BackupFileInfo = {
	key: string;
	isMonthly: boolean;
	date: Date;
};

export function generateBackupKey(date: Date, isMonthly = false): string {
	const yyyy = date.getUTCFullYear();
	const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(date.getUTCDate()).padStart(2, "0");

	if (isMonthly) {
		return `backups/monthly/backup-${yyyy}-${mm}-01-monthly.json.gz`;
	}
	return `backups/daily/backup-${yyyy}-${mm}-${dd}.json.gz`;
}

function parseBackupKey(key: string): BackupFileInfo | null {
	const dailyMatch = key.match(
		/backups\/daily\/backup-(\d{4})-(\d{2})-(\d{2})\.json\.gz$/,
	);
	const monthlyMatch = key.match(
		/backups\/monthly\/backup-(\d{4})-(\d{2})-01-monthly\.json\.gz$/,
	);

	if (dailyMatch) {
		const [, year, month, day] = dailyMatch;
		return {
			key,
			isMonthly: false,
			date: new Date(
				Date.UTC(
					parseInt(year, 10),
					parseInt(month, 10) - 1,
					parseInt(day, 10),
				),
			),
		};
	}

	if (monthlyMatch) {
		const [, year, month] = monthlyMatch;
		return {
			key,
			isMonthly: true,
			date: new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, 1)),
		};
	}

	return null;
}

export type RotationResult = {
	deleted: string[];
	kept: string[];
	promoted: string[];
	errors: string[];
};

export async function rotateBackups(
	bucket: R2Bucket,
	now: Date = new Date(),
): Promise<RotationResult> {
	const result: RotationResult = {
		deleted: [],
		kept: [],
		promoted: [],
		errors: [],
	};

	const cutoffDate = new Date(now);
	cutoffDate.setUTCDate(cutoffDate.getUTCDate() - DAILY_RETENTION_DAYS);

	const dailyList = await bucket.list({ prefix: "backups/daily/" });
	const monthlyList = await bucket.list({ prefix: "backups/monthly/" });

	const monthlyBackupMonths = new Set<string>();
	for (const obj of monthlyList.objects) {
		const info = parseBackupKey(obj.key);
		if (info) {
			const monthKey = `${info.date.getUTCFullYear()}-${info.date.getUTCMonth()}`;
			monthlyBackupMonths.add(monthKey);
		}
		result.kept.push(obj.key);
	}

	for (const obj of dailyList.objects) {
		const info = parseBackupKey(obj.key);
		if (!info) {
			result.kept.push(obj.key);
			continue;
		}

		const isOld = info.date < cutoffDate;
		const monthKey = `${info.date.getUTCFullYear()}-${info.date.getUTCMonth()}`;
		const isFirstOfMonth = info.date.getUTCDate() === 1;

		if (isOld) {
			if (isFirstOfMonth && !monthlyBackupMonths.has(monthKey)) {
				try {
					const monthlyKey = generateBackupKey(info.date, true);
					const srcObj = await bucket.get(obj.key);
					if (srcObj) {
						await bucket.put(monthlyKey, srcObj.body, {
							httpMetadata: srcObj.httpMetadata,
							customMetadata: {
								...srcObj.customMetadata,
								promotedFrom: obj.key,
								promotedAt: now.toISOString(),
							},
						});
						monthlyBackupMonths.add(monthKey);
						result.promoted.push(monthlyKey);
					}
				} catch (err) {
					result.errors.push(`Failed to promote ${obj.key}: ${err}`);
				}
			}

			try {
				await bucket.delete(obj.key);
				result.deleted.push(obj.key);
			} catch (err) {
				result.errors.push(`Failed to delete ${obj.key}: ${err}`);
			}
		} else {
			result.kept.push(obj.key);
		}
	}

	return result;
}
