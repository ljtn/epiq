import chalk from 'chalk';
import {resolveEnvActor} from '../lib/config/actor-env.js';
import {loadSettingsFromConfig} from '../lib/config/user-config.js';
import {
	isFail,
	isSuccess,
	Result,
	succeeded,
	failed,
} from '../lib/model/result-types.js';
import {patchSettingsState} from '../lib/state/settings.state.js';
import {openBrowser} from './open-browser.js';
import {startGuiServer} from './api/api-server.js';

export const startGui = async (input: {
	repoRoot: string;
}): Promise<Result<{url: string}>> => {
	// The GUI server process has its own settings singleton; without this it never
	// picks up the user's config and silently falls back to $VISUAL/$EDITOR.
	// Same as the TUI: an unresolvable environment actor is fatal, because
	// carrying on means serving the board as the configured user instead.
	const envActor = resolveEnvActor({});
	if (isFail(envActor)) return failed(envActor.message);

	const settings = loadSettingsFromConfig();
	if (isSuccess(settings)) patchSettingsState(settings.value);

	const serverResult = await startGuiServer({...input, boardId: ''});

	if (isFail(serverResult)) return serverResult;

	const {url} = serverResult.value;

	console.log(`Epiq GUI running at ${chalk.cyan(url)}`);

	openBrowser(url);

	return succeeded('Started GUI', {url});
};
