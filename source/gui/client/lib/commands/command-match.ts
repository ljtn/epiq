// Matching and ranking for the palette, over commands and over the arguments of
// a two-stage one alike — both are "a label, maybe some extra words to find it
// by", so both go through here.

export type Matchable = {
	id: string;
	title: string;
	keywords?: string[];
};

export type Match<T> = {
	item: T;
	// Indices into the title that the query hit, for the row to highlight. Empty
	// where the match came from a keyword rather than the title itself.
	hits: number[];
	score: number;
};

// A subsequence rather than a substring: "cmt" finds "Comment on ticket", which
// is what anyone typing quickly expects. Returns where it matched, so the row
// can mark the same characters the reader aimed at.
const subsequenceHits = (text: string, query: string): number[] | null => {
	const lowerText = text.toLowerCase();
	const hits: number[] = [];
	let at = 0;

	for (const character of query) {
		const found = lowerText.indexOf(character, at);
		if (found === -1) return null;

		hits.push(found);
		at = found + 1;
	}

	return hits;
};

// Higher is better. Three things earn points, in the order a reader would rank
// them: the query is a prefix of what they are looking at, the match is
// unbroken, and it starts early.
const scoreHits = (text: string, query: string, hits: number[]): number => {
	const prefix = text.toLowerCase().startsWith(query) ? 1000 : 0;

	let contiguous = 0;
	for (let index = 1; index < hits.length; index += 1) {
		if (hits[index]! === hits[index - 1]! + 1) contiguous += 1;
	}

	return prefix + contiguous * 10 - (hits[0] ?? 0);
};

/**
 * Ranks `items` against `query`.
 *
 * An empty query is the palette's resting state rather than a match of
 * everything: `recentIds` leads, most recent first, and the rest keep the order
 * they were declared in — which is grouped, and deliberate.
 *
 * `rank` orders within equal scores. It is what keeps unavailable commands last
 * without hiding them, the way the TUI palette does.
 */
export const matchItems = <T extends Matchable>(
	items: readonly T[],
	query: string,
	options: {
		recentIds?: readonly string[];
		rank?: (item: T) => number;
		// Kept after ranking, so what survives is the best of the whole set and
		// not the first N it happened to scan. A project can hold thousands of
		// tickets and the list is a picker: nobody reads past the top of it, and
		// a row that is never read still costs a DOM node to build.
		limit?: number;
	} = {},
): Match<T>[] => {
	const {recentIds = [], rank = () => 0, limit} = options;
	const normalized = query.trim().toLowerCase();
	const cap = <R>(matches: R[]): R[] =>
		limit === undefined ? matches : matches.slice(0, limit);

	if (!normalized) {
		const recency = new Map(
			recentIds.map((id, index) => [id, recentIds.length - index]),
		);

		const ordered = [...items]
			.map((item, index) => ({item, hits: [], score: 0, index}))
			.sort((a, b) => {
				const byRank = rank(a.item) - rank(b.item);
				if (byRank !== 0) return byRank;

				const byRecency =
					(recency.get(b.item.id) ?? 0) - (recency.get(a.item.id) ?? 0);
				if (byRecency !== 0) return byRecency;

				return a.index - b.index;
			});

		return cap(ordered.map(({item, hits, score}) => ({item, hits, score})));
	}

	const scored = items.flatMap(item => {
		const titleHits = subsequenceHits(item.title, normalized);

		if (titleHits) {
			return [
				{
					item,
					hits: titleHits,
					score: scoreHits(item.title, normalized, titleHits),
				},
			];
		}

		// The keywords carry the TUI spelling and a ticket's ref, so `:tag` finds
		// "Add a tag" and `ABC1234` finds the ticket it names. No hits: nothing in
		// the title to mark.
		const byKeyword = [item.id, ...(item.keywords ?? [])].some(keyword =>
			keyword.toLowerCase().includes(normalized),
		);

		return byKeyword ? [{item, hits: [], score: 0}] : [];
	});

	return cap(
		scored.sort((a, b) => {
			const byRank = rank(a.item) - rank(b.item);
			if (byRank !== 0) return byRank;

			return b.score - a.score;
		}),
	);
};
