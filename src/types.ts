export type User = {
	id: number;
	username: string;
	admin?: number | null;
	email?: string | null;
};

export type Friend = {
	id: number;
	username: string;
};

export type BlockedUser = {
	id: number;
	username: string;
	blocked_at: number;
};

export type FriendProfile = {
	id: number;
	username: string;
	friendCount: number;
	lifetimeOysSent: number;
	lifetimeOysReceived: number;
	lastOyType: string | null;
	lastOyCreatedAt: number | null;
	lastOyFromUserId: number | null;
	streak: number;
};

export type LastOyInfo = {
	friend_id: number;
	last_oy_type: string | null;
	last_oy_created_at: number | null;
	last_oy_from_user_id: number | null;
	streak: number;
};

export type FriendWithLastOy = Friend & Omit<LastOyInfo, "friend_id">;

export type OyPayload = {
	lat: number;
	lon: number;
	accuracy?: number | null;
	city?: string | null;
};

export type Oy = {
	id: number;
	from_user_id: number;
	to_user_id: number;
	from_username: string;
	to_username: string;
	created_at: number;
	type: string;
	payload?: OyPayload | null;
};

export type SearchUser = Friend & { added?: boolean; mutuals?: number };

export type OysCursor = {
	before: number;
	beforeId: number;
};

export type PasskeySummary = {
	id: number;
	device_name: string | null;
	created_at: number;
	last_used_at?: number | null;
};

export type PasskeyStatus = {
	hasPasskey: boolean;
	passkeys: PasskeySummary[];
};
