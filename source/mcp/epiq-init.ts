import {ulid} from 'ulid';
import {ACTOR_NAME_ENV} from '../lib/config/actor-env.js';
import {recordRecentProject} from '../lib/config/recent-projects.js';
import {readEpiqConfig, setConfig} from '../lib/config/user-config.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {
	initProject,
	InitProjectOutcome,
} from '../lib/project-setup/init-project.js';
import {logger} from '../logger.js';

// Setting up a board from an agent, without the TUI. The tools here run before
// a project exists, so unlike the rest of the API they never boot: there is no
// project.json to resolve yet, and the board is what they create.

type InitInput = {
	repoRoot?: string;
	userName?: string;
	preferredEditor?: string;
	autoSync?: boolean;
};

// What the TUI's setup screen asks for, in its order, with the question the
// agent should put to the user. A board can be written without an editor or
// autosync, but the TUI would greet the user with its setup screen the first
// time they opened it, so the same three fields are required here.
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
 * Sets up a board in a git repository for the configured user, recording the
 * user's setup answers on the way. Called without them on a machine that has
 * none, it says which are missing rather than guessing: the answers are the
 * user's, and the agent is expected to ask and call again. Whatever was given
 * is kept, so the second call needs only the rest.
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

	// The name asked for here is the user's. An agent's own — the one this
	// server was launched with or assumed — would make the agent the configured
	// user, signing everything the TUI and GUI do as the agent from then on.
	if (givenName && envActor && normalize(givenName) === normalize(envActor)) {
		return failed(
			`userName "${givenName}" is this agent's own identity. Pass the user's name, the one they want the TUI and GUI to write as.`,
		);
	}

	const patch: Parameters<typeof setConfig>[0] = {};

	if (givenName) {
		patch.userName = givenName;
		patch.userId = config.userId || ulid();
	}

	const editor = input.preferredEditor?.trim();
	if (editor) patch.preferredEditor = editor;

	if (input.autoSync !== undefined) patch.autoSync = input.autoSync;

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

		return failed(
			`Setup incomplete. Ask the user for: ${asks}. Then call epiq_project_init again with the answers; what was given so far is saved.`,
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
