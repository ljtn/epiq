/**
 * `commit-msg` hook: refuse a commit whose subject starts with a broken ticket
 * ref, or that stages a project file from another project. Fails open.
 */
import fs from 'node:fs';
import {getStateBranch} from '../git/git-constants.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {loadMergedEvents} from '../lib/board/board-log.js';
import {isFail} from '../lib/model/result-types.js';
import {
	describeIdentityMismatch,
	findStagedIdentityDrift,
	STATE_IDENTITY_PATH,
} from '../lib/project-setup/project-identity.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {checkCommitRef} from '../lib/utils/commit-ref.js';

// Every action that introduces a node. A ref names a node, so these are the
// only payloads whose `id` can be behind one.
const NODE_ACTIONS = new Set([
	'init.workspace',
	'add.workspace',
	'add.board',
	'add.swimlane',
	'add.issue',
	'add.field',
]);

const allow = (): never => process.exit(0);

const collectNodeIds = (): string[] => {
	const repoRoot = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRoot)) return [];

	const stateBranchRoot = getStateBranchRoot({repoRoot: repoRoot.value});
	if (isFail(stateBranchRoot)) return [];

	const events = loadMergedEvents(stateBranchRoot.value);
	if (isFail(events)) return [];

	return events.value.flatMap(event => {
		if (!NODE_ACTIONS.has(event.action)) return [];

		// Every action in NODE_ACTIONS carries an `id`, but the payload union
		// spans actions that do not, so the narrowing has to happen here.
		const {id} = event.payload as {id?: unknown};

		return typeof id === 'string' ? [id] : [];
	});
};

// A staged project file whose id is not the state branch's. The branch's
// identity comes from git, not from the staged file.
const refuseIdentityDrift = async (): Promise<void> => {
	const repoRoot = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRoot)) return;

	const stateBranch = getStateBranch(repoRoot.value);
	if (isFail(stateBranch)) return;

	const stateBranchRoot = getStateBranchRoot({repoRoot: repoRoot.value});

	const drift = await findStagedIdentityDrift({
		repoRoot: repoRoot.value,
		stateBranch: stateBranch.value,
		stateBranchRoot: isFail(stateBranchRoot) ? null : stateBranchRoot.value,
	});
	if (isFail(drift) || drift.value === null) return;

	process.stderr.write(
		`\nCommit refused: ${STATE_IDENTITY_PATH} would point this checkout at another project.\n\n${describeIdentityMismatch(
			{...drift.value, stateBranch: stateBranch.value},
		)}\n\n--no-verify skips this check.\n\n`,
	);
	process.exit(1);
};

const main = async () => {
	await refuseIdentityDrift();

	const messagePath = process.argv[2];
	if (!messagePath || !fs.existsSync(messagePath)) allow();

	const subject =
		fs.readFileSync(messagePath as string, 'utf8').split('\n')[0] ?? '';

	const verdict = checkCommitRef(subject, collectNodeIds());
	if (verdict.ok) allow();

	process.stderr.write(
		`\nCommit refused: the subject starts with a broken ticket ref.\n\n${
			verdict.ok ? '' : verdict.reason
		}\n\nCommit without a ref, or fix it. --no-verify skips this check.\n\n`,
	);
	process.exit(1);
};

try {
	await main();
} catch {
	// Never let this hook be the reason a commit cannot be made.
	allow();
}
