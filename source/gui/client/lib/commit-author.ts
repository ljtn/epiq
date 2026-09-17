import {GuiCommitEntry} from './gui-state.model';
import {actorDisplay} from './agent-identity';

/**
 * What to write next to a commit.
 *
 * A claimed address gives the contributor's board name, drawn the way the log
 * draws it, so an agent reads as `/peter` in both places rather than as its
 * full identity in one and its git name in the other. Anything else keeps the
 * raw git name, which is what the board showed before any of this existed.
 */
export const commitAuthorLabel = (commit: GuiCommitEntry): string => {
	const resolved = commit.authorIdentity;

	// The server made the decision and says so. Inferring it by comparing the
	// resolved name against the git name would call somebody unresolved whenever
	// the two happen to match — an agent committing under its own board name —
	// and hand back the full identity where `/peter` was the point.
	if (!resolved?.resolved) return commit.author;

	return actorDisplay(resolved.name).label;
};
