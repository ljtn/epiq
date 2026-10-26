// Matching and ranking for the palette, over commands and their arguments.

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

// A subsequence, so "cmt" finds "Comment on ticket". Returns the matched
// positions for highlighting.
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

// Higher is better: prefix, then unbroken, then early.
const scoreHits = (text: string, query: string, hits: number[]): number => {
	const prefix = text.toLowerCase().startsWith(query) ? 1000 : 0;

	let contiguous = 0;
	for (let index = 1; index < hits.length; index += 1) {
		if (hits[index]! === hits[index - 1]! + 1) contiguous += 1;
	}

	return prefix + contiguous * 10 - (hits[0] ?? 0);
};

/**
 * Ranks `items` against `query`. An empty query lists `recentIds` first, then
 * the rest in declared order; `rank` orders within equal scores.
 */
export const matchItems = <T extends Matchable>(
	items: readonly T[],
	query: string,
	options: {
		recentIds?: readonly string[];
		rank?: (item: T) => number;
		// Applied after ranking, so the best of the whole set survive.
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

		// Keywords carry the TUI spelling and a ticket's ref; no title hits to mark.
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
