import {execGit} from '../../git/git-utils.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {isTicketNode} from '../model/context.model.js';
import {getState, isStateInitialized} from '../state/state.js';
import {commitTicketRef} from '../utils/commit-ref.js';
import {nodeRef} from '../utils/node-ref.js';
import {
	adoptStagedClone,
	discardStage,
	listRepoStates,
	stageClone,
} from './commit-repo-fetch.js';
import {
	MAX_REPOS,
	planRepoChange,
	readConnectedRepos,
	readRepoProject,
	REPO_RENAMED,
	REPO_UNCHANGED,
	sinceDate,
	writeRepoEvent,
	type CommitRepo,
	type RepoChange,
} from './commit-repos.js';
import {invalidateCommitTimelineCache} from './commit-timeline.js';

// Connecting a repo makes every contributor's epiq download it, so it is never
// one step. A first call clones it into a stage and says what it is and what
// it costs, writing nothing; only a second call that confirms writes the event,
// and the staged clone moves into place.

export type RepoPreview = {
	repo: CommitRepo;
	/** Where every contributor's epiq will download it from. */
	host: string;
	defaultBranch: string | null;
	latest: {subject: string; author: string; date: string} | null;
	/** Commits in the window the connect asks for. */
	commits: number;
	/** How many of those name a ticket on this board: none is a warning. */
	ticketCommits: number;
	/** The staged clone's size: what each contributor's epiq will download. */
	bytes: number;
	contributors: number;
	/** What this board's other clones already take on this machine. */
	claimedBytes: number;
	/** Whether the board already reads as many repos as it will fetch. */
	overLimit: boolean;
	expiresAt: number;
};

export type ConnectOutcome =
	| {kind: 'preview'; preview: RepoPreview}
	| {kind: 'connected' | 'updated' | 'unchanged'; repo: CommitRepo};

/** How long a preview's staged clone waits for its confirm. */
export const STAGE_TTL_MS = 15 * 60 * 1000;

type Stage = {
	stagePath: string;
	key: string;
	preview: RepoPreview;
	timer: NodeJS.Timeout;
};

// One per repo, per process: a confirm moves only a clone this process staged.
const stages = new Map<string, Stage>();

const stageKey = (repoRoot: string, repo: CommitRepo) =>
	JSON.stringify([repoRoot, repo.id, repo.branches, repo.since]);

const dropStage = (repoId: string) => {
	const stage = stages.get(repoId);
	if (!stage) return;

	clearTimeout(stage.timer);
	stages.delete(repoId);
	discardStage(stage.stagePath);
};

/** Abandons a preview, clearing its staged clone. */
export const cancelRepoPreview = (repoId: string): void => dropStage(repoId);

export const hostOfRepoUrl = (url: string): string => {
	if (url.startsWith('file:')) return 'this machine';

	const scp = /^[^@/]+@([^:/]+):/.exec(url);
	if (scp?.[1]) return scp[1];

	try {
		return new URL(url).host || url;
	} catch {
		return url;
	}
};

const git = async (cwd: string, args: string[]): Promise<string | null> => {
	const result = await execGit({cwd, args, forClone: true, keepPartial: true});
	return isFail(result) ? null : result.value.stdout;
};

const readFacts = async (
	stagePath: string,
	window: string | null,
	knownRefs: ReadonlySet<string>,
) => {
	const head = (await git(stagePath, ['symbolic-ref', '--short', 'HEAD']))
		?.trim()
		.replace(/^refs\/heads\//, '');

	const latestRaw = await git(stagePath, [
		'log',
		'-1',
		'--format=%s%x00%an%x00%cI',
		'HEAD',
	]);
	const [subject, author, date] = (latestRaw ?? '').trim().split('\0');

	// Subjects only, capped: enough to count, never the whole history in memory.
	const subjects =
		(await git(stagePath, [
			'log',
			'--branches',
			'--max-count=100000',
			// An epoch, as the clone's window is: git reads a bare date as that
			// day at the current time of day.
			...(window
				? [`--since=@${Math.floor(Date.parse(`${window}T00:00:00Z`) / 1000)}`]
				: []),
			'--format=%s',
		])) ?? '';
	const lines = subjects.split('\n').filter(Boolean);

	return {
		defaultBranch: head || null,
		latest:
			subject !== undefined && subject !== '' && author && date
				? {subject, author, date}
				: null,
		commits: lines.length,
		ticketCommits: lines.filter(line => commitTicketRef(line, knownRefs))
			.length,
	};
};

// What the board says about itself: its tickets' refs, and who works on it.
const boardFacts = () => {
	if (!isStateInitialized())
		return {knownRefs: new Set<string>(), contributors: 0};

	const state = getState();
	return {
		knownRefs: new Set(
			Object.values(state.nodes)
				.filter(node => isTicketNode(node))
				.map(node => nodeRef(node.id)),
		),
		contributors: Object.values(state.contributors).filter(
			contributor => !contributor.tombstoned,
		).length,
	};
};

/** What this board's clones take on this machine, as their last fetches measured. */
export const claimedBytesOf = (repoRoot: string): number => {
	const states = listRepoStates(repoRoot);
	return isFail(states)
		? 0
		: states.value.reduce((sum, state) => sum + (state.bytes ?? 0), 0);
};

/**
 * How a connect is asked for:
 * - `auto`: an option change applies; a new repo is previewed.
 * - `preview`: nothing is written; a new repo is staged and previewed.
 * - `confirm`: an option change applies; a new repo connects only with the
 *   clone this process staged for it, and is never staged here — a caller
 *   holding a lock asks this, and a clone can take minutes.
 */
export type ConnectMode = 'auto' | 'preview' | 'confirm';

/**
 * Connects a repo, or changes a connected one's options. A new connect (or a
 * reconnect) is previewed first and written only on a confirm.
 */
export const connectCommitRepo = async (
	input: RepoChange & {
		actorId: string;
		mode: ConnectMode;
	},
): Promise<Result<ConnectOutcome>> => {
	const planResult = planRepoChange(input);
	if (isFail(planResult)) return failed(planResult.message);
	const plan = planResult.value;

	if (plan.kind === 'unchanged') {
		return succeeded(REPO_UNCHANGED, {kind: 'unchanged', repo: plan.repo});
	}

	if (plan.kind === 'edit' && input.mode === 'preview') {
		return succeeded(`${plan.repo.label} is already connected`, {
			kind: 'unchanged',
			repo: plan.repo,
		});
	}

	if (plan.kind === 'edit') {
		const written = writeRepoEvent({
			repoRoot: input.repoRoot,
			actorId: input.actorId,
			event: {action: 'edit.repo', payload: plan.event},
		});
		if (isFail(written)) return failed(written.message);

		// A rename moves no commit: the cached logs stay warm.
		if (!plan.message.startsWith(REPO_RENAMED)) invalidateCommitTimelineCache();
		return succeeded(plan.message, {kind: 'updated', repo: plan.repo});
	}

	const key = stageKey(input.repoRoot, plan.repo);
	const stage = stages.get(plan.repo.id);

	if (input.mode === 'confirm' && stage?.key !== key) {
		return failed(
			'Nothing is staged for this connect here, or it was staged with other options: preview it again',
		);
	}

	if (input.mode === 'confirm' && stage) {
		clearTimeout(stage.timer);
		stages.delete(plan.repo.id);

		const written = writeRepoEvent({
			repoRoot: input.repoRoot,
			actorId: input.actorId,
			event: {action: 'connect.repo', payload: plan.event},
		});
		if (isFail(written)) {
			discardStage(stage.stagePath);
			return failed(written.message);
		}

		await adoptStagedClone(input.repoRoot, plan.repo, stage.stagePath);

		const listed = readConnectedRepos(input.repoRoot);
		const pastCap =
			!isFail(listed) &&
			listed.value.overLimit.some(repo => repo.id === plan.repo.id);

		return succeeded(
			pastCap
				? `Connected ${plan.repo.label}, but the board already reads ${MAX_REPOS} repos: it is not fetched until one ahead of it is disconnected`
				: `Connected ${plan.repo.label}`,
			{kind: 'connected', repo: plan.repo},
		);
	}

	dropStage(plan.repo.id);

	const projectResult = readRepoProject(input.repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	const staged = await stageClone(input.repoRoot, plan.repo);
	if (isFail(staged)) return failed(`Could not clone it: ${staged.message}`);

	const board = boardFacts();
	const facts = await readFacts(
		staged.value.stagePath,
		sinceDate(plan.repo.since, projectResult.value.createdAt),
		board.knownRefs,
	);

	const listed = readConnectedRepos(input.repoRoot);
	const preview: RepoPreview = {
		repo: plan.repo,
		host: hostOfRepoUrl(plan.repo.url),
		...facts,
		bytes: staged.value.bytes,
		contributors: board.contributors,
		claimedBytes: claimedBytesOf(input.repoRoot),
		overLimit: !isFail(listed) && listed.value.live.length >= MAX_REPOS,
		expiresAt: Date.now() + STAGE_TTL_MS,
	};

	const timer = setTimeout(() => dropStage(plan.repo.id), STAGE_TTL_MS);
	timer.unref();
	stages.set(plan.repo.id, {
		stagePath: staged.value.stagePath,
		key,
		preview,
		timer,
	});

	return succeeded('Preview: nothing is connected until you confirm', {
		kind: 'preview',
		preview,
	});
};
