import {
	englishDataset,
	englishRecommendedTransformers,
	RegExpMatcher,
} from "obscenity";

const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
});

export function containsAbusiveText(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	return matcher.hasMatch(normalized);
}

export function validateCleanUsername(username: string): string | null {
	if (containsAbusiveText(username)) {
		return "Username contains disallowed language";
	}
	return null;
}
