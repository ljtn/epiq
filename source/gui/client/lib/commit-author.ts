import {GuiCommitEntry} from './gui-state.model';

/**
 * The contributor's board name where their address is claimed, else the git
 * name. In full: the event log groups lanes on it, so callers shorten.
 */
export const commitAuthorLabel = (commit: GuiCommitEntry): string => {
	const resolved = commit.authorIdentity;

	// Trust the server's flag: an agent committing under its board name would
	// otherwise read as unresolved.
	if (!resolved?.resolved) return commit.author;

	return resolved.name;
};
