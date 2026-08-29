import {renderApp} from './Index.js';
import {loadProject, loadWithoutProject} from './lib/boot/load-project.js';
import {resolveEnvActor} from './lib/config/actor-env.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import {
	Result,
	isSuccess,
	isFail,
	succeeded,
} from './lib/model/result-types.js';
import {patchSettingsState} from './lib/state/settings.state.js';
import {resolveClosestEpiqProjectRoot} from './lib/storage/paths.js';
import {failAt, formatUnknownError} from './lib/utils/logger.utils.js';

export async function bootTui(): Promise<Result<void>> {
	try {
		// A settings failure is normal on an unconfigured machine — setup handles
		// it. An environment that names an actor it cannot resolve is not: booting
		// on would write as the configured user, which is what naming one avoids.
		const envActor = resolveEnvActor({});
		if (isFail(envActor)) return failAt(0, envActor.message);

		const settings = loadSettingsFromConfig();
		if (isSuccess(settings)) patchSettingsState(settings.value);

		const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());

		const loadResult = isSuccess(repoRootResult)
			? await loadProject(repoRootResult.value)
			: loadWithoutProject();

		if (isFail(loadResult)) return loadResult;

		const renderResult = renderApp();
		if (isFail(renderResult)) return failAt(6, renderResult.message);

		initListeners();

		return succeeded('Booted Epiq', undefined);
	} catch (error) {
		return failAt(0, formatUnknownError(error));
	}
}
