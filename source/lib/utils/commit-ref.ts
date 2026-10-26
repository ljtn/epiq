import {NODE_REF_LENGTH, nodeRef} from './node-ref.js';

/**
 * Whether a commit subject's leading token is a broken ticket ref. Commits
 * need no ref, but anything that looks like one must resolve.
 */

// Crockford base32 (no I, L, O, U), which rules out most English words.
const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

// A subject that never carries a ref: git writes the first three itself, and
// epiq writes the last.
const EXEMPT = [/^Merge /, /^Revert "/, /^fixup! /, /^squash! /, /^\[epiq:/];

export type CommitRefVerdict = {ok: true} | {ok: false; reason: string};

const looksLikeRef = (token: string): boolean =>
	CROCKFORD.test(token.toUpperCase());

/** `knownIds` is every node id; refs are derived here, not by the caller. */
export const checkCommitRef = (
	subject: string,
	knownIds: Iterable<string>,
): CommitRefVerdict => {
	const trimmed = subject.trim();
	if (!trimmed) return {ok: true};

	if (EXEMPT.some(pattern => pattern.test(trimmed))) return {ok: true};

	const token = (trimmed.split(/\s+/)[0] ?? '').toUpperCase();
	if (!token || !looksLikeRef(token)) return {ok: true};

	const refs = new Set<string>();
	for (const id of knownIds) refs.add(nodeRef(id));

	// Nothing to check against: an empty or unreadable board never blocks.
	if (refs.size === 0) return {ok: true};

	if (refs.has(token)) return {ok: true};

	// A token inside exactly one real ref is a truncated ref.
	const contained = [...refs].filter(
		ref => ref.includes(token) && ref !== token,
	);

	if (contained.length === 1) {
		return {
			ok: false,
			reason:
				`"${token}" is not a ticket ref, but "${contained[0]}" is, and ` +
				`contains it.\nA ref is the last ${NODE_REF_LENGTH} characters of ` +
				`the id — read it off the MCP response rather than slicing the id ` +
				`by hand.\n\n  Did you mean:  ${contained[0]} ${trimmed
					.split(/\s+/)
					.slice(1)
					.join(' ')}`,
		};
	}

	// Right shape, no such ticket: likely a typo.
	if (token.length === NODE_REF_LENGTH) {
		return {
			ok: false,
			reason:
				`"${token}" is shaped like a ticket ref but matches no ticket on ` +
				`this board.\nCheck it against the board, or reword the subject so ` +
				`it does not start with a ref-shaped token.`,
		};
	}

	// Ambiguous or ordinary prose. Not enough evidence to block a commit.
	return {ok: true};
};

// The ticket a subject's leading token links to, or null.
export const commitTicketRef = (
	subject: string,
	knownRefs: ReadonlySet<string>,
): string | null => {
	const token = (subject.trim().split(/\s+/)[0] ?? '').toUpperCase();

	return token && knownRefs.has(token) ? token : null;
};

// Every ticket a commit links to, where the board knows it: the one its
// subject leads with, then those its Epiq-Ref lines name.
export const commitTicketRefs = (
	commit: {subject: string; refs?: readonly string[]},
	knownRefs: ReadonlySet<string>,
): string[] => {
	const prefix = commitTicketRef(commit.subject, knownRefs);
	const named = (commit.refs ?? []).map(ref => ref.toUpperCase());

	return [...new Set([...(prefix ? [prefix] : []), ...named])].filter(ref =>
		knownRefs.has(ref),
	);
};
