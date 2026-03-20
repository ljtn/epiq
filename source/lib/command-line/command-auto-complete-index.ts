export type PrefixIndex = Map<string, string[]>;

export const createPrefixIndex = (words: string[]): PrefixIndex => {
	const index = new Map<string, string[]>();

	for (const word of words) {
		for (let i = 1; i <= word.length; i++) {
			const prefix = word.slice(0, i);
			const bucket = index.get(prefix);

			if (bucket) {
				bucket.push(word);
			} else {
				index.set(prefix, [word]);
			}
		}
	}

	return index;
};

export const getPrefixMatches = (
	index: PrefixIndex,
	input: string,
): string[] => {
	if (!input) {
		return [];
	}

	return index.get(input) ?? [];
};
