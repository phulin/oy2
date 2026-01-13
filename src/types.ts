export type User = {
	id: number;
	username: string;
};

export type Friend = {
	id: number;
	username: string;
};

export type OyPayload = {
	lat: number;
	lon: number;
	accuracy?: number | null;
};

export type Oy = {
	id: number;
	from_username: string;
	created_at: number;
	type: string;
	payload?: OyPayload | null;
};

export type SearchUser = Friend & { added?: boolean };
