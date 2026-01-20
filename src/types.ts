export type User = {
	id: number;
	username: string;
	admin?: number | null;
};

export type Friend = {
	id: number;
	username: string;
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
