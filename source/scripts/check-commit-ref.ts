/**
 * `commit-msg` hook: refuse a commit whose subject starts with a broken ticket
 * ref, or that would point this checkout at a project other than the one the
 * state branch is.
 *
 * Linking a commit to a ticket is an exact `<REF> ` prefix match, so a ref one
 * character short matches nothing and says nothing — the ticket shows no
 * commits for ever. This is the only place that failure becomes visible.
 *
 * Fails open on every question it cannot answer: no project, no state worktree,
 * an unreadable log, a thrown anything. A commit must never be blocked because
 * the board was hard to read; it is blocked only when a ref-shaped token is
 * demonstrably wrong, or a staged project id demonstrably disagrees with the
 * branch.
 */
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import {getStateBranch} from '../git/git-constants.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {isFail} from '../lib/model/result-types.js';
import {
	describeIdentityMismatch,
	readStateIdentity,
	STATE_IDENTITY_PATH,
} from '../lib/project-setup/project-identity.js';
import {EpiqProject} from '../lib/project-setup/project-setup.js';
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

// A staged project file whose id is not the state branch's: the commit that
// started JQS9XDR, refused where it is made. Silent unless the file is staged
// and the branch has an identity to disagree with.
const refuseIdentityDrift = (): void => {
	const repoRoot = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRoot)) return;

	const staged = execSync('git diff --cached --name-only', {
		cwd: repoRoot.value,
		encoding: 'utf8',
	});
	if (!staged.split('\n').includes(STATE_IDENTITY_PATH)) return;

	const stateBranchRoot = getStateBranchRoot({repoRoot: repoRoot.value});
	if (isFail(stateBranchRoot)) return;

	const branch = readStateIdentity(stateBranchRoot.value);
	if (isFail(branch) || branch.value === null) return;

	const checkout = JSON.parse(
		execSync(`git show :${STATE_IDENTITY_PATH}`, {
			cwd: repoRoot.value,
			encoding: 'utf8',
		}),
	) as EpiqProject;
	if (checkout.projectId === branch.value.projectId) return;

	const stateBranch = getStateBranch(repoRoot.value);

	process.stderr.write(
		`\nCommit refused: ${STATE_IDENTITY_PATH} would point this checkout at another project.\n\n${describeIdentityMismatch(
			{
				checkout,
				branch: branch.value,
				stateBranch: isFail(stateBranch)
					? 'the state branch'
					: stateBranch.value,
			},
		)}\n\n--no-verify skips this check.\n\n`,
	);
	process.exit(1);
};

const main = () => {
	refuseIdentityDrift();

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
	main();
} catch {
	// Never let this hook be the reason a commit cannot be made.
	allow();
}
