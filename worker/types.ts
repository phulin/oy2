import type { Context, Hono } from "hono";

export type DbClient = {
	query: <T = unknown>(
		sql: string,
		params?: unknown[],
	) => Promise<{ rows: T[]; rowCount: number }>;
	end: () => Promise<void> | void;
};

export type Bindings = {
	HYPERDRIVE: Hyperdrive;
	TEST_DB?: DbClient;
	VAPID_PUBLIC_KEY: string;
	VAPID_PRIVATE_KEY: string;
	VAPID_SUBJECT?: string;
	OY2: KVNamespace;
	// OAuth
	APPLE_CLIENT_ID: string;
	APPLE_TEAM_ID: string;
	APPLE_KEY_ID: string;
	APPLE_PRIVATE_KEY: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	GOOGLE_MAPS_API_KEY: string;
	// Email
	RESEND_API_KEY: string;
	// WebAuthn
	RP_NAME: string;
	WEBAUTHN_ORIGIN?: string;
	WEBAUTHN_RP_ID?: string;
};

export type User = {
	id: number;
	username: string;
	created_at?: number;
	phone?: string | null;
	phone_verified?: number | null;
	admin?: number | null;
	oauth_provider?: string | null;
	oauth_sub?: string | null;
	email?: string | null;
};

export type Passkey = {
	id: number;
	user_id: number;
	credential_id: Uint8Array;
	public_key: Uint8Array;
	counter: number;
	transports?: string[] | null;
	created_at: number;
	last_used_at?: number | null;
	device_name?: string | null;
};

export type FriendUser = {
	id: number;
	username: string;
	mutuals?: number;
};

export type FriendListRow = {
	id: number;
	username: string;
};

export type LastOyInfoRow = {
	friend_id: number;
	last_oy_type: string | null;
	last_oy_created_at: number | null;
	last_oy_from_user_id: number | null;
	streak_start_date: number | null;
};

export type PushSubscriptionRow = {
	endpoint: string;
	keys_p256dh: string;
	keys_auth: string;
};

export type PushPayload = {
	title: string;
	body: string;
	icon?: string;
	badge?: string;
	type: "oy" | "lo";
	tag?: string;
	url?: string;
	notificationId?: number;
	createdAt?: number;
	fromUserId?: number;
};

export type OyRow = {
	id: number;
	from_user_id: number;
	to_user_id: number;
	type: string | null;
	payload: string | null;
	created_at: number;
	from_username: string;
	to_username: string;
};

export type OysCursor = {
	before: number;
	beforeId: number;
};

export type AppVariables = {
	user: User | null;
	sessionToken: string | null;
	db: DbClient;
};

export type App = Hono<{
	Bindings: Bindings;
	Variables: AppVariables;
}>;

export type AppContext = Context<{
	Bindings: Bindings;
	Variables: AppVariables;
}>;
