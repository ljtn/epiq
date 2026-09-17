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

	// The identity always comes back populated, and falls back to the git name
	// itself, so an unresolved author is one whose id is not a board id. Compared
	// on the name rather than a flag because the server has already made the
	// decision and a second flag would be a second source of truth.
	if (!resolved || resolved.name === commit.author) return commit.author;

	return actorDisplay(resolved.name).label;
};
