import {fetchCommitRepos} from '../../lib/commits/commits.js';
import {isFail} from '../../lib/model/result-types.js';

// The GUI fetches connected repos on sync, and the seeded repo has no remote to
// sync with — so a test fetches them as a sync would, in this process, over
// the same clones directory the server reads. The server learns of the fetch
// from the clone itself: the panel on reopening, the ticket's commits on the
// next read.
export const fetchConnectedRepos = async ({
	repoRoot,
	globalDir,
}: {
	repoRoot: string;
	globalDir: string;
}): Promise<void> => {
	process.env['EPIQ_GLOBAL_DIR'] = globalDir;
	const result = await fetchCommitRepos({repoRoot});
	if (isFail(result)) throw new Error(result.message);
};
