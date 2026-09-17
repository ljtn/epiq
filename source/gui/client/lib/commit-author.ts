import {GuiCommitEntry} from './gui-state.model';

/**
 * Who a commit is by: the contributor's board name where their address is
 * claimed, and the raw git name otherwise, which is what the board showed
 * before any of this existed.
 *
 * The board name in full, not `actorDisplay`'s short form. Every caller either
 * shortens it itself or groups on it, and a pre-shortened name breaks the
 * second: the event log keys a lane on this string, so `/peter` from a commit
 * and `claude/peter` from a board event became two lanes under one heading.
 * Shortening is a drawing decision and belongs where the drawing happens.
 */
export const commitAuthorLabel = (commit: GuiCommitEntry): string => {
	const resolved = commit.authorIdentity;

	// The server made the decision and says so. Inferring it by comparing the
	// resolved name against the git name would call somebody unresolved whenever
	// the two happen to match — an agent committing under its own board name —
	// and hand back the full identity where `/peter` was the point.
	if (!resolved?.resolved) return commit.author;

	return resolved.name;
};
