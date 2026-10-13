// Repo events written straight into a board's log, for tests of what reads
// them: no booted board, no actor setup, the line a real connect would leave.
// Written as another process would, so a board booted here derives them on
// its next read rather than taking them for its own applied writes.
import {ulid} from 'ulid';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {persist} from '../../lib/board/board-log.js';
import {clearAccountedSignature} from '../../lib/event/log-signature.js';
import {repoIdOf} from '../../lib/board/board-repos.js';
import {isFail} from '../../lib/model/result-types.js';

export const TEST_REPO_ACTOR = '01JZTESTREPOACTOR000000000';

type RepoFields = {
	branches?: 'default' | 'all';
	since?: string;
	label?: string;
};

type RepoEventInput =
	| {action: 'connect.repo'; payload: {url: string} & RepoFields}
	| {action: 'edit.repo'; payload: {repo: string} & RepoFields}
	| {action: 'disconnect.repo'; payload: {repo: string}};

export const writeRepoEvents = (
	board: string,
	events: RepoEventInput[],
	userId = TEST_REPO_ACTOR,
): void => {
	const root = getStateBranchRoot({repoRoot: board});
	if (isFail(root)) throw new Error(root.message);

	for (const event of events) {
		const written = persist({
			event: {id: ulid(), userId, ...event} as Parameters<
				typeof persist
			>[0]['event'],
			rootDir: root.value,
		});
		if (isFail(written)) throw new Error(written.message);
	}

	clearAccountedSignature();
};

export const connectRepoEvent = (
	board: string,
	url: string,
	fields: RepoFields = {},
	userId?: string,
) =>
	writeRepoEvents(
		board,
		[{action: 'connect.repo', payload: {url, ...fields}}],
		userId,
	);

export const editRepoEvent = (
	board: string,
	url: string,
	fields: RepoFields,
	userId?: string,
) =>
	writeRepoEvents(
		board,
		[{action: 'edit.repo', payload: {repo: repoIdOf(url), ...fields}}],
		userId,
	);

export const disconnectRepoEvent = (
	board: string,
	url: string,
	userId?: string,
) =>
	writeRepoEvents(
		board,
		[{action: 'disconnect.repo', payload: {repo: repoIdOf(url)}}],
		userId,
	);
