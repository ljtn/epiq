// Human-readable shorthand reference for a node (issue, board, ...), derived
// from the random tail of its ULID: the last 7 characters are entropy.
// 01KS22YK9AXCMATZXTR5JZCS5M -> 5JZCS5M.
export const NODE_REF_LENGTH = 7;

export const nodeRef = (id: string): string =>
	id.slice(-NODE_REF_LENGTH).toUpperCase();

// Matching ignores case and tolerates a typed hyphen, so `5jzcs5m`,
// `5JZ-CS5M`, and `zcs5` all find the node.
export const nodeRefMatches = (id: string, query: string): boolean => {
	const normalizedQuery = query.replace(/-/g, '').trim().toUpperCase();
	if (!normalizedQuery) return true;

	return nodeRef(id).includes(normalizedQuery);
};
