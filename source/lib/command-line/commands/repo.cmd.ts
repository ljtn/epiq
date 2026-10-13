import {
	connectCommitRepo,
	disconnectCommitRepo,
	isAllowedRepoUrl,
	isRepoLabel,
	isRepoSince,
	readConnectedRepos,
	RepoBranches,
	resolveRepoRoot,
	type CommitRepo,
	type RepoPreview,
} from '../../commits/commits.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getSettingsState} from '../../state/settings.state.js';
import {formatBytes} from '../../utils/format-bytes.js';
import {sanitizeInlineText} from '../../utils/string.utils.js';

// `:config repoConnect <url> [branches=default|all] [since=board|all|YYYY-MM-DD]
// [label=<name>] [confirm]` and `:config repoDisconnect <name>`: the TUI's way
// to the repos the GUI's palette opens. Both write board events, which sync
// like any other change. A new repo is previewed first, and connected only
// when the same line is run again with `confirm`.

export type RepoConnectArgs = {
	url: string;
	branches?: RepoBranches;
	since?: string;
	label?: string;
	confirm?: boolean;
};

export const REPO_CONNECT_OPTIONS = [
	'branches=default',
	'branches=all',
	'since=board',
	'since=all',
	'since=YYYY-MM-DD',
	'label=<name>',
	'confirm',
];

/** The typed line as a request, or why it is not one yet. */
export const parseRepoConnectArgs = (
	input: string,
): Result<RepoConnectArgs> => {
	const [url = '', ...options] = input.trim().split(/\s+/).filter(Boolean);
	if (!url) return failed('a remote URL to read commits from');
	if (!isAllowedRepoUrl(url)) {
		return failed('https://, ssh://, git://, file:/// or user@host:path');
	}

	const args: RepoConnectArgs = {url};
	const seen = new Set<string>();

	for (const option of options) {
		// At the first `=` only: a label may carry one.
		const split = option.indexOf('=');
		const key = split === -1 ? option : option.slice(0, split);
		const value = split === -1 ? '' : option.slice(split + 1);

		if (seen.has(key)) return failed(`one ${key}=, not two`);
		seen.add(key);

		if (option === 'confirm') {
			args.confirm = true;
		} else if (key === 'branches' && (value === 'default' || value === 'all')) {
			args.branches = value;
		} else if (key === 'since' && isRepoSince(value)) {
			args.since = value;
		} else if (key === 'label' && (value === '' || isRepoLabel(value))) {
			// `label=` alone goes back to the URL's basename.
			args.label = value;
		} else {
			// Read after `Expected`, as every refusal here is.
			return failed(`${REPO_CONNECT_OPTIONS.join(', ')}; not "${option}"`);
		}
	}

	return succeeded('Parsed', args);
};

/** The connected repos, past the cap included, for `repoDisconnect`. */
export const registeredRepos = (): CommitRepo[] => {
	const repoRootResult = resolveRepoRoot();
	if (isFail(repoRootResult)) return [];

	const reposResult = readConnectedRepos(repoRootResult.value);
	return isFail(reposResult)
		? []
		: [...reposResult.value.live, ...reposResult.value.overLimit];
};

/** A preview as one status line: what it is, what it costs, how to go on. */
export const describeRepoPreview = (preview: RepoPreview): string => {
	// From the repo being previewed, which may be anybody's: never raw to the
	// terminal.
	const latest = preview.latest
		? `latest "${sanitizeInlineText(preview.latest.subject).slice(
				0,
				60,
		  )}" by ${sanitizeInlineText(preview.latest.author).slice(0, 40)}`
		: 'no commits';
	const linked =
		preview.ticketCommits === 0
			? 'none linked, wrong repo?'
			: `${preview.ticketCommits} linked`;

	return [
		`${preview.repo.label} from ${preview.host}`,
		preview.defaultBranch
			? sanitizeInlineText(preview.defaultBranch).slice(0, 60)
			: 'no default branch',
		latest,
		`${preview.commits} commits, ${linked}`,
		formatBytes(preview.bytes),
		preview.overLimit
			? 'over the limit: not downloaded until another repo is disconnected'
			: preview.contributors > 1
			? `all ${preview.contributors} contributors download it on next sync`
			: 'everyone downloads it on next sync',
	].join(' · ');
};

// The last preview, so the confirm line it leaves typed out can say what it
// will connect.
let lastPreview: {line: string; summary: string} | null = null;

const confirmLineOf = (line: string) => `${line.trim()} confirm`;

/** What a `confirm` line will connect, if this TUI previewed it. */
export const previewSummaryFor = (inputString: string): string | null =>
	lastPreview && lastPreview.line === inputString.trim()
		? lastPreview.summary
		: null;

export const repoConnectCommand = async (): Promise<
	Result<{followUp: string} | null>
> => {
	const line = getCmdState().commandMeta.inputString;
	const argsResult = parseRepoConnectArgs(line);
	if (isFail(argsResult)) return failed(`Expected ${argsResult.message}`);

	const {userId} = getSettingsState();
	if (!userId) return failed('Set a username first with :config username');

	const repoRootResult = resolveRepoRoot();
	if (isFail(repoRootResult)) return repoRootResult;

	const result = await connectCommitRepo({
		repoRoot: repoRootResult.value,
		actorId: userId,
		url: argsResult.value.url,
		branches: argsResult.value.branches,
		since: argsResult.value.since,
		label: argsResult.value.label,
		mode: argsResult.value.confirm ? 'confirm' : 'auto',
	});
	if (isFail(result)) return failed(result.message);

	if (result.value.kind === 'preview') {
		const confirmLine = confirmLineOf(line);
		lastPreview = {
			line: confirmLine,
			summary: describeRepoPreview(result.value.preview),
		};
		return succeeded(lastPreview.summary, {
			followUp: `config repoConnect ${confirmLine}`,
		});
	}

	if (argsResult.value.confirm) lastPreview = null;

	return succeeded(
		result.value.kind === 'connected'
			? `${result.message} — it syncs with the board; :sync fetches it`
			: result.message,
		null,
	);
};

export const repoDisconnectCommand = (): Result<null> => {
	const {userId} = getSettingsState();
	if (!userId) return failed('Set a username first with :config username');

	const repoRootResult = resolveRepoRoot();
	if (isFail(repoRootResult)) return repoRootResult;

	const result = disconnectCommitRepo({
		repoRoot: repoRootResult.value,
		actorId: userId,
		repo: getCmdState().commandMeta.inputString,
	});
	if (isFail(result)) return failed(result.message);

	return succeeded(`${result.message} — it syncs with the board`, null);
};
