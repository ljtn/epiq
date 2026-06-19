import {AppState} from '../model/app-state.model.js';
import {isFail} from '../model/result-types.js';
import {getSafeState} from '../state/state.js';
import {DEFAULT_WORDS} from './default-word-list.js';

/**
 * Corpus-based auto-completion vocabulary.
 *
 * Instead of guessing useful words up front, we derive them from the text the
 * user has actually written into the board — node titles, ticket descriptions,
 * field values, tags, contributors and comments — read straight from the
 * in-memory materialized state (never from the .jsonl event files). The static
 * DEFAULT_WORDS list is kept only as a cold-start fallback for an empty board.
 *
 * Ordering matters: getPrefixMatches() returns matches in insertion order and
 * the completion layer picks hints[0], so we emit corpus words first, ranked by
 * frequency, then the leftover defaults.
 */

const MIN_WORD_LENGTH = 3;

// Small stoplist — descriptions/comments are full of filler that would
// otherwise dominate the frequency ranking. Keep this short and English-only.
const STOPWORDS = new Set([
	'the',
	'and',
	'for',
	'are',
	'but',
	'not',
	'you',
	'all',
	'any',
	'can',
	'was',
	'one',
	'our',
	'out',
	'use',
	'this',
	'that',
	'with',
	'have',
	'from',
	'will',
	'your',
	'they',
	'them',
	'then',
	'than',
	'when',
	'what',
	'were',
	'been',
	'into',
	'should',
	'would',
	'could',
	'about',
]);

/** Pull every piece of user-authored text out of the materialized state. */
const collectText = (state: AppState): string[] => {
	const texts: string[] = [];

	for (const node of Object.values(state.nodes)) {
		if (node.title) texts.push(node.title);

		const props = node.props as Record<string, unknown>;
		if (typeof props['description'] === 'string') {
			texts.push(props['description']);
		}
		if (typeof props['value'] === 'string') {
			texts.push(props['value']);
		}
	}

	for (const tag of Object.values(state.tags)) texts.push(tag.name);
	for (const contributor of Object.values(state.contributors)) {
		texts.push(contributor.name);
	}
	for (const comment of Object.values(state.comments)) texts.push(comment.md);

	return texts;
};

const tokenize = (text: string): string[] =>
	text
		.toLowerCase()
		// split on anything that isn't a word char; good enough for markdown too
		.split(/[^a-z0-9]+/)
		.filter(
			token =>
				token.length >= MIN_WORD_LENGTH &&
				!STOPWORDS.has(token) &&
				// drop pure numbers and ids
				!/^\d+$/.test(token),
		);

/**
 * Build a frequency-ranked vocabulary from the board's text, then append any
 * DEFAULT_WORDS not already present as a fallback tail.
 */
export const buildCorpusVocabulary = (state: AppState): string[] => {
	const counts = new Map<string, number>();

	for (const text of collectText(state)) {
		for (const token of tokenize(text)) {
			counts.set(token, (counts.get(token) ?? 0) + 1);
		}
	}

	const corpusWords = [...counts.entries()]
		// frequency desc, then alphabetical for stable ties
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([word]) => word);

	const seen = new Set(corpusWords);
	const fallback = DEFAULT_WORDS.filter(word => !seen.has(word));

	return [...corpusWords, ...fallback];
};

// ---------------------------------------------------------------------------
// Lazy cache
//
// getVocabulary() is hit on every keystroke, so we memoize and only rebuild
// when the board's text could have changed. eventLog.length is a cheap,
// monotonic fingerprint: every content edit (title/description/tag/comment/…)
// appends an event, so a change in length means the corpus may have changed.
// getPrefixIndex() memoizes by array identity, so returning a fresh array on
// rebuild transparently re-indexes downstream.
// ---------------------------------------------------------------------------

let _vocabulary: string[] = DEFAULT_WORDS;
let _fingerprint = -1;

export const getVocabulary = (): string[] => {
	const stateResult = getSafeState();
	if (isFail(stateResult)) return DEFAULT_WORDS;

	const state = stateResult.value;
	const fingerprint = state.eventLog.length;

	if (fingerprint !== _fingerprint) {
		_vocabulary = buildCorpusVocabulary(state);
		_fingerprint = fingerprint;
	}

	return _vocabulary;
};
