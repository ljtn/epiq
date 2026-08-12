import chalk from 'chalk';
import {loadSettingsFromConfig} from '../lib/config/user-config.js';
import {
	isFail,
	isSuccess,
	Result,
	succeeded,
} from '../lib/model/result-types.js';
import {patchSettingsState} from '../lib/state/settings.state.js';
import {openBrowser} from './open-browser.js';
import {startGuiServer} from './api/api-server.js';

export const startGui = async (input: {
	repoRoot: string;
}): Promise<Result<{url: string}>> => {
	// Mirrors bootTui's own settings load (source/boot-tui.tsx) — without this,
	// the GUI server process's settings singleton never picks up
	// ~/.epiq-global/config.json (preferredEditor, etc.), and code that reads
	// getSettingsState() (e.g. the commit-diff "open in editor" feature)
	// silently falls back to raw $VISUAL/$EDITOR instead of the user's actual
	// configured preference.
	const settings = loadSettingsFromConfig();
	if (isSuccess(settings)) patchSettingsState(settings.value);

	const serverResult = await startGuiServer({...input, boardId: ''});

	if (isFail(serverResult)) return serverResult;

	const {url} = serverResult.value;

	console.log(`Epiq GUI running at ${chalk.cyan(url)}`);

	openBrowser(url);

	return succeeded('Started GUI', {url});
};
