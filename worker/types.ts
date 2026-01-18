import type { Context, Hono } from "hono";

export type Bindings = {
	DB: D1Database;
	VAPID_PUBLIC_KEY: string;
	VAPID_PRIVATE_KEY: string;
	VAPID_SUBJECT?: string;
	TEXTBELT_API_KEY: string;
	OY2: KVNamespace;
};

export type User = {
	id: number;
	username: string;
	created_at?: number;
	phone?: string | null;
	phone_verified?: number | null;
	admin?: number | null;
	last_seen?: number | null;
};

export type FriendUser = {
	id: number;
	username: string;
	mutuals?: number;
};

export type FriendListRow = {
	id: number;
	username: string;
	last_yo_type: string | null;
	last_yo_created_at: number | null;
	last_yo_from_user_id: number | null;
	streak: number;
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
};

export type YoRow = {
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
	bootMs: number;
};

export type App = Hono<{
	Bindings: Bindings;
	Variables: AppVariables;
}>;

export type AppContext = Context<{
	Bindings: Bindings;
	Variables: AppVariables;
}>;
