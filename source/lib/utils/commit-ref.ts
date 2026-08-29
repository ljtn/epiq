import {NODE_REF_LENGTH, nodeRef} from './node-ref.js';

/**
 * Decides whether a commit subject's leading token is a *broken* ticket ref.
 *
 * Commit-to-ticket linking matches an exact `<REF> ` prefix, so a ref that is
 * one character short simply matches nothing: the ticket shows no commits, for
 * ever, and nothing anywhere reports it. Four commits reached main with
 * truncated refs before this existed, because a silent failure teaches nobody.
 *
 * Deliberately not "every commit needs a ref". Plenty of legitimate commits
 * carry none, and demanding one would make this a nuisance rather than a
 * safety net. The rule is narrower: *if it looks like a ref, it has to resolve.*
 */

// Crockford base32, which is what a ULID tail is: no I, L, O or U. Excluding
// those four is most of why this can look at an English word without crying
// wolf — `BUILD`, `POLISH` and `INLINE` are all disqualified by a letter.
const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

// A subject that never carries a ref: git writes the first three itself, and
// epiq writes the last.
const EXEMPT = [/^Merge /, /^Revert "/, /^fixup! /, /^squash! /, /^\[epiq:/];

export type CommitRefVerdict = {ok: true} | {ok: false; reason: string};

const looksLikeRef = (token: string): boolean =>
	CROCKFORD.test(token.toUpperCase());

/**
 * `knownIds` is every node id on the board; refs are derived here so callers
 * cannot pass a set that was itself built by slicing an id wrongly.
 */
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

	// Nothing to check against. A board with no tickets and a board this
	// checkout could not read look identical here, and blocking a commit over
	// the difference is the wrong way to be wrong.
	if (refs.size === 0) return {ok: true};

	if (refs.has(token)) return {ok: true};

	// The truncation case, and the one worth being confident about: a token
	// that is part of exactly one real ref is a ref somebody shortened, not a
	// word that happens to be spelled in base32.
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

	// Right shape, right length, no such ticket. Most likely a typo; possibly a
	// ticket from a board this checkout cannot see, which is why the caller
	// fails open when it could not read the board at all.
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
