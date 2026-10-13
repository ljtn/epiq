import fs from 'node:fs';
import path from 'node:path';
import {
	fetchCommitRepos,
	readConnectedRepos,
	type CommitRepo,
} from '../../lib/commits/commits.js';
import {isFail} from '../../lib/model/result-types.js';
import {writeRepoEvents} from '../helpers/repo-events.js';

type Board = {repoRoot: string; globalDir: string};

// The GUI fetches connected repos on sync, and the seeded repo has no remote to
// sync with — so a test fetches them as a sync would, in this process, over
// the same clones directory the server reads. The server learns of the fetch
// from the clone itself: the panel on reopening, the ticket's commits on the
// next read.
export const fetchConnectedRepos = async ({
	repoRoot,
	globalDir,
}: Board): Promise<void> => {
	process.env['EPIQ_GLOBAL_DIR'] = globalDir;
	const result = await fetchCommitRepos({repoRoot});
	if (isFail(result)) throw new Error(result.message);
};

/** The repos the board's log connects, past the limit or not. */
export const connectedRepos = ({repoRoot, globalDir}: Board): CommitRepo[] => {
	process.env['EPIQ_GLOBAL_DIR'] = globalDir;
	const result = readConnectedRepos(repoRoot);
	if (isFail(result)) throw new Error(result.message);
	return [...result.value.live, ...result.value.overLimit];
};

/** Connects repos by writing their events, as another clone's sync would. */
export const connectByEvent = (
	{repoRoot, globalDir}: Board,
	urls: string[],
): void => {
	process.env['EPIQ_GLOBAL_DIR'] = globalDir;
	writeRepoEvents(
		repoRoot,
		urls.map(url => ({action: 'connect.repo' as const, payload: {url}})),
	);
};

/**
 * Runs `body` with every repo disconnected afterwards, whatever happens: the
 * worker's board is shared by every test in it.
 */
export const withNoRepos = async (
	board: Board,
	body: () => Promise<void>,
): Promise<void> => {
	try {
		await body();
	} finally {
		const repos = connectedRepos(board);
		if (repos.length > 0) {
			writeRepoEvents(
				board.repoRoot,
				repos.map(repo => ({
					action: 'disconnect.repo' as const,
					payload: {repo: repo.id},
				})),
			);
		}
	}
};

/** Everything under the board's clones directory: clones, statuses, stages. */
export const clonesDirEntries = ({globalDir}: Board): string[] => {
	const reposDir = path.join(globalDir, 'repos');
	if (!fs.existsSync(reposDir)) return [];
	return fs
		.readdirSync(reposDir)
		.flatMap(project =>
			fs.statSync(path.join(reposDir, project)).isDirectory()
				? fs.readdirSync(path.join(reposDir, project))
				: [],
		);
};
