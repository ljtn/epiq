// Human-readable shorthand reference for an issue, derived from the random
// tail of its ULID: the last 7 characters are entropy
// 01KS22YK9AXCMATZXTR5JZCS5M -> 5JZCS5M, displayed as 5JZ-CS5M.
export const ISSUE_REF_LENGTH = 7;

export const issueRef = (id: string): string =>
	id.slice(-ISSUE_REF_LENGTH).toUpperCase();

export const formatIssueRef = (id: string): string => {
	const ref = issueRef(id);
	return `${ref.slice(0, 3)}-${ref.slice(3)}`;
};

// Matching ignores the display hyphen and case, so both `5jz-cs5m` and
// `zcs5` find the issue.
export const issueRefMatches = (id: string, query: string): boolean => {
	const normalizedQuery = query.replace(/-/g, '').trim().toUpperCase();
	if (!normalizedQuery) return true;

	return issueRef(id).includes(normalizedQuery);
};
