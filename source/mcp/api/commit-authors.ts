import {commitAuthorIdentity} from '../../lib/repository/contributor-directory.js';
import {isFail, Result, succeeded} from '../../lib/model/result-types.js';
import {emailOwnerIndex} from '../../lib/model/email-link.js';
import {getSafeState} from '../../lib/state/state.js';
import {CommitEntry} from '../../lib/commits/commits.js';

/**
 * Puts a board identity on each commit whose author's address is claimed. Kept
 * out of the git reader, which stays pure; unbooted, commits keep git names.
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
