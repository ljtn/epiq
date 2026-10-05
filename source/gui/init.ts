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
import {EPIQ_VERSION} from '../version.js';
import {launchBanner} from './launch-banner.js';
import {canOpenBrowser, openBrowser} from './open-browser.js';
import {startGuiServer} from './api/api-server.js';
import {
	canonicalRepoRoot,
	PREFERRED_GUI_PORT,
	probeGuiInstance,
} from './api/instance.js';

export const startGui = async (input: {
	repoRoot: string;
	// False for `--no-open`.
	open?: boolean;
}): Promise<Result<{url: string}>> => {
	const open = (url: string) => {
		if (input.open !== false && canOpenBrowser()) openBrowser(url);
	};

	// The GUI server process has its own settings singleton; without this it never
	// picks up the user's config and silently falls back to $VISUAL/$EDITOR.
	// Same as the TUI: an unresolvable environment actor is fatal, because
	// carrying on means serving the board as the configured user instead.
	const envActor = resolveEnvActor({});
	if (isFail(envActor)) return failed(envActor.message);

	const settings = loadSettingsFromConfig();
	if (isSuccess(settings)) patchSettingsState(settings.value);

	// An epiq already serving this project on the usual port is the one to open,
	// not something to start a rival to. A second server would land on an
	// ephemeral port, and since browser storage is scoped to the whole origin —
	// port included — that new origin arrives with none of the panel widths,
	// board selection or lane state the first one has been keeping.
	//
	// Only this exact case is reused. A different project, or anything that
	// isn't epiq, falls through to the existing fallback: taking a port from
	// either of them is a decision for TYR7186, not a side effect of booting.
	const running = await probeGuiInstance(PREFERRED_GUI_PORT);

	if (running && running.repoRoot === canonicalRepoRoot(input.repoRoot)) {
		const url = `http://127.0.0.1:${PREFERRED_GUI_PORT}`;

		console.log(
			launchBanner({
				url,
				repoRoot: input.repoRoot,
				version: EPIQ_VERSION,
				reused: true,
			}),
		);

		open(url);

		return succeeded('Reused running GUI', {url});
	}

	const serverResult = await startGuiServer({
		repoRoot: input.repoRoot,
		boardId: '',
	});

	if (isFail(serverResult)) return serverResult;

	const {url} = serverResult.value;

	console.log(
		launchBanner({
			url,
			repoRoot: input.repoRoot,
			version: EPIQ_VERSION,
			reused: false,
		}),
	);

	open(url);

	return succeeded('Started GUI', {url});
};
