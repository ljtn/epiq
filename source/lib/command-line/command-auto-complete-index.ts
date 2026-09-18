export type PrefixIndex = Map<string, string[]>;

export const createPrefixIndex = (words: string[]): PrefixIndex => {
	const index = new Map<string, string[]>();

	for (const word of words) {
		// Keyed on the lowercased prefix, holding the word as it is written. The
		// lookup lowercases its input, so a word with a capital in it — a person's
		// git name, a ticket title — could never be matched while the key kept its
		// own case. Every list here happened to be lowercase until one was not.
		const normalized = word.toLowerCase();

		for (let i = 1; i <= word.length; i++) {
			const prefix = normalized.slice(0, i);
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
