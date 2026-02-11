import type { App, AppContext, User } from "../types";

type DsarRequestType =
	| "access"
	| "delete"
	| "correct"
	| "portability"
	| "object"
	| "restrict";

const allowedTypes: ReadonlySet<DsarRequestType> = new Set([
	"access",
	"delete",
	"correct",
	"portability",
	"object",
	"restrict",
]);

function buildDsarEmailHtml(input: {
	user: User;
	requestType: DsarRequestType;
	jurisdiction: string;
	details: string;
}): string {
	const { user, requestType, jurisdiction, details } = input;
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 24px; margin: 0;">
  <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px;">
    <h1 style="margin: 0 0 16px; font-size: 22px; color: #111;">DSAR Request</h1>
    <p style="margin: 0 0 8px; color: #333;"><strong>User ID:</strong> ${user.id}</p>
    <p style="margin: 0 0 8px; color: #333;"><strong>Username:</strong> ${user.username}</p>
    <p style="margin: 0 0 8px; color: #333;"><strong>Email:</strong> ${user.email ?? "Not set"}</p>
    <p style="margin: 0 0 8px; color: #333;"><strong>Request Type:</strong> ${requestType}</p>
    <p style="margin: 0 0 8px; color: #333;"><strong>Jurisdiction:</strong> ${jurisdiction}</p>
    <p style="margin: 0 0 8px; color: #333;"><strong>Details:</strong></p>
    <pre style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 8px; margin: 0;">${details}</pre>
  </div>
</body>
</html>`;
}

export function registerDsarRoutes(app: App) {
	app.post("/api/dsar", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const body = await c.req.json();
		const requestType = String(
			body.requestType ?? "",
		).trim() as DsarRequestType;
		const jurisdiction = String(body.jurisdiction ?? "").trim();
		const details = String(body.details ?? "").trim();

		if (!allowedTypes.has(requestType)) {
			return c.json({ error: "Invalid request type" }, 400);
		}
		if (!jurisdiction) {
			return c.json({ error: "Jurisdiction is required" }, 400);
		}
		if (!details) {
			return c.json({ error: "Details are required" }, 400);
		}

		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: "Oy <noreply@oyme.site>",
				to: ["contact@oyme.site"],
				reply_to: user.email ? [user.email] : undefined,
				subject: `DSAR ${requestType} request from @${user.username} (#${user.id})`,
				html: buildDsarEmailHtml({
					user,
					requestType,
					jurisdiction,
					details,
				}),
			}),
		});

		if (!response.ok) {
			return c.json({ error: "Failed to submit DSAR request" }, 502);
		}

		return c.json({ success: true });
	});
}
