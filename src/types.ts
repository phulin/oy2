export type User = {
	id: number;
	username: string;
};

export type Friend = {
	id: number;
	username: string;
};

export type FriendWithLastYo = Friend & {
	last_yo_type: string | null;
	last_yo_created_at: number | null;
	last_yo_from_user_id: number | null;
};

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

export type SearchUser = Friend & { added?: boolean };

export type OysCursor = {
	before: number;
	beforeId: number;
};
