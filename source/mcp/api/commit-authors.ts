import {commitAuthorIdentity} from '../../lib/repository/contributor-directory.js';
import {isFail, Result, succeeded} from '../../lib/model/result-types.js';
import {emailOwnerIndex} from '../../lib/model/email-link.js';
import {getSafeState} from '../../lib/state/state.js';
import {CommitEntry} from '../epiq-time-travel.js';

/**
 * Puts a board identity on each commit, where its author's address is claimed.
 *
 * Applied here rather than inside the git reader, which stays a pure function
 * of the repository so it can answer mid-scrub without touching the state
 * singleton. Both ways into the commit list — the scrubber's window and a
 * ticket's Code tab — go through this, so neither can resolve an author the
 * other would not.
 *
 * With no state booted every commit keeps its raw git name, which is the same
 * answer an unclaimed address gets. A caller that forgets to boot degrades to
 * today's behaviour rather than to a wrong name.
 */
export const withCommitAuthors = <T extends CommitEntry>(
	commits: Result<T[]>,
): Result<T[]> => {
	if (isFail(commits)) return commits;

	const stateResult = getSafeState();

	const links = isFail(stateResult) ? {} : stateResult.value.emailLinks;
	const registry = isFail(stateResult) ? {} : stateResult.value.contributors;

	// Built once for the whole batch. Per commit it would walk every link on the
	// board, which is the shape that only shows up on a board big enough to care.
	const owners = emailOwnerIndex(links);

	const resolved = commits.value.map(commit => ({
		...commit,
		authorIdentity: commitAuthorIdentity({
			authorName: commit.author,
			authorEmail: commit.authorEmail,
			owners,
			registry,
		}),
	}));

	return succeeded(commits.message, resolved);
};
