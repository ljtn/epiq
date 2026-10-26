import {ulid} from 'ulid';
import {ACTOR_NAME_ENV} from '../lib/config/actor-env.js';
import {recordRecentProject} from '../lib/config/recent-projects.js';
import {readGitName} from '../lib/config/git-identity.js';
import {readEpiqConfig, setConfig} from '../lib/config/user-config.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {
	initProject,
	InitProjectOutcome,
} from '../lib/project-setup/init-project.js';
import {logger} from '../logger.js';

// Setting up a board from an agent. These run before a project exists, so they
// never boot.

type InitInput = {
	repoRoot?: string;
	userName?: string;
	preferredEditor?: string;
	autoSync?: boolean;
};

// The TUI setup screen's questions, in order; required so the TUI doesn't greet
// the user with setup on first open.
const SETUP_FIELDS = [
	{
		name: 'userName',
		question: 'the name they want to appear under on the board',
	},
	{
		name: 'preferredEditor',
		question:
			'the command that opens a file for editing, e.g. "vim", "nano" or "code --wait"',
	},
	{
		name: 'autoSync',
		question:
			'whether the TUI and GUI should sync with the git remote on their own (true or false)',
	},
] as const;

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * Sets up a board for the configured user. Missing setup answers are reported,
 * not guessed: the agent asks the user and calls again.
 */
export const initProjectTool = async (
	input: InitInput = {},
): Promise<
	Result<
		Omit<InitProjectOutcome, 'defaultEvents'> & {
			user: {userId: string; userName: string};
		}
	>
> => {
	const configResult = readEpiqConfig();
	if (isFail(configResult)) return failed(configResult.message);
	const config = configResult.value;

	const givenName = input.userName?.trim();
	const envActor = (process.env[ACTOR_NAME_ENV] ?? '').trim();

	// The name must be the user's, not the agent's, or the agent becomes the
	// configured user.
	if (givenName && envActor && normalize(givenName) === normalize(envActor)) {
		return failed(
			`userName "${givenName}" is this agent's own identity. Pass the user's name, the one they want the TUI and GUI to write as.`,
		);
	}

	// Fills in what the machine lacks, never changes what it has: that is the
	// user's `:config`.
	const given = {
		userName: givenName || undefined,
		preferredEditor: input.preferredEditor?.trim() || undefined,
		autoSync: input.autoSync,
	};

	const existing = {
		userName: config.userName?.trim() || undefined,
		preferredEditor: config.preferredEditor?.trim() || undefined,
		autoSync:
			typeof config.autoSync === 'boolean' ? config.autoSync : undefined,
	};

	for (const field of SETUP_FIELDS) {
		const wanted = given[field.name];
		const current = existing[field.name];

		if (wanted === undefined || current === undefined || wanted === current) {
			continue;
		}

		return failed(
			`This machine is already set up with ${field.name} ${JSON.stringify(
				current,
			)}; epiq_project_init does not change it. Call again without ${
				field.name
			}, or let the user change it in the TUI with :config.`,
		);
	}

	const patch: Parameters<typeof setConfig>[0] = {};

	if (given.userName && !existing.userName) patch.userName = given.userName;
	if (given.preferredEditor && !existing.preferredEditor) {
		patch.preferredEditor = given.preferredEditor;
	}
	if (given.autoSync !== undefined && existing.autoSync === undefined) {
		patch.autoSync = given.autoSync;
	}

	// A name without an id is not a user yet; the id is minted once and kept.
	if ((patch.userName || existing.userName) && !config.userId) {
		patch.userId = ulid();
	}

	if (Object.keys(patch).length > 0) {
		const persisted = setConfig(patch);
		if (isFail(persisted)) return failed(persisted.message);
	}

	const merged = {...config, ...patch};

	const missing = SETUP_FIELDS.filter(field => {
		const value = merged[field.name];
		return typeof value === 'boolean' ? false : !value?.trim();
	});

	if (missing.length > 0) {
		const asks = missing
			.map(field => `${field.name} (${field.question})`)
			.join('; ');

		// Proposed, never configured unasked: git config on a shared box or in an
		// agent container may not be the user.
		const suggestion = missing.some(field => field.name === 'userName')
			? await readGitName(input.repoRoot ?? process.cwd())
			: null;

		const proposal = suggestion
			? ` This repository's git user.name is ${JSON.stringify(
					suggestion,
			  )} — offer it as the default for userName, and use it only if the user agrees.`
			: '';

		return failed(
			`Setup incomplete. Ask the user for: ${asks}.${proposal} Then call epiq_project_init again with the answers; what was given so far is saved.`,
		);
	}

	const user = {userId: merged.userId ?? '', userName: merged.userName ?? ''};
	if (!user.userId || !user.userName) {
		return failed('Missing Epiq user id');
	}

	const initResult = await initProject({
		cwd: input.repoRoot ?? process.cwd(),
		user,
	});
	if (isFail(initResult)) return initResult;

	const {defaultEvents: _events, ...outcome} = initResult.value;

	const remembered = recordRecentProject({root: outcome.repoRoot});
	if (isFail(remembered)) logger.info(remembered.message);

	const message =
		outcome.warnings.length === 0
			? 'Project initialized'
			: `Project initialized, with warnings: ${outcome.warnings.join(' ')}`;

	return succeeded(message, {...outcome, user});
};
