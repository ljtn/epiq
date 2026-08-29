import {nodeRefMatches} from './node-ref.js';

// Shared by the TUI's `:filter` and the GUI's text filter, so the two agree on
// what a query matches.
export const normalizeText = (value: string): string =>
	value.trim().toLocaleLowerCase();

export const textIncludes = (haystack: string, query: string): boolean =>
	normalizeText(haystack).includes(normalizeText(query));

// A ticket matches on its ref (same rules as `nodeRefMatches`) or its title.
// An empty query matches everything.
export const issueMatchesText = (
	issue: {id: string; title: string},
	query: string,
): boolean => {
	if (!normalizeText(query)) return true;

	return nodeRefMatches(issue.id, query) || textIncludes(issue.title, query);
};
