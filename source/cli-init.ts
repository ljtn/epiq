import {recordRecentProject} from './lib/config/recent-projects.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {failed, isFail, Result, succeeded} from './lib/model/result-types.js';
import {initProject} from './lib/project-setup/init-project.js';
import {logger} from './logger.js';

/**
 * `epiq init`: a board for this repository without the TUI, for scripts. Needs
 * only an author, configured or `EPIQ_USER_NAME`; the TUI asks the rest of setup.
 */
export const initFromCli = async (
	cwd: string,
): Promise<Result<{repoRoot: string}>> => {
	// Before anything is written: a board must never be authored by nobody.
	const settings = loadSettingsFromConfig();
	const {userId, userName} = isFail(settings)
		? {userId: null, userName: null}
		: settings.value;
	if (!userId || !userName) {
		const reason = isFail(settings) ? settings.message : 'No user configured';
		return failed(
			`${reason}. Run \`epiq setup\` first, or set EPIQ_USER_NAME.`,
		);
	}
	const result = await initProject({cwd, user: {userId, userName}});
	if (isFail(result)) return result;

	const {repoRoot, warnings} = result.value;

	const remembered = recordRecentProject({root: repoRoot});
	if (isFail(remembered)) logger.info(remembered.message);

	const message = [
		`Project initialized in ${repoRoot}`,
		...warnings.map(warning => `Warning: ${warning}`),
	].join('\n');

	return succeeded(message, {repoRoot});
};
