import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {getUserSetupStatus} from '../../config/setup-utils.js';
import {materializeAll} from '../../event/event-materialize.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {initProject} from '../../project-setup/init-project.js';
import {replaceCmdInput} from '../../state/cmd.state.js';
import {getSettingsState} from '../../state/settings.state.js';
import {getSafeState, patchState} from '../../state/state.js';

const failAt = (step: number, message: string) =>
	failed(`[${step}] ${message}`);

export const initCommand = async () => {
	// Clear cmd input
	replaceCmdInput('');

	// resolve user ids from ~/.epiq-global/config.json
	const setupStatus = getUserSetupStatus();
	if (!setupStatus.isSetupDone || !setupStatus.userName) {
		return failAt(
			5,
			'Missing Epiq user configuration (userId / userName). Run setup first.',
		);
	}

	const settings = getSettingsState();
	const userName = settings.userName;
	const userId = settings.userId;
	if (!userId || !userName) {
		return failAt(5, 'Missing Epiq user id');
	}

	const initResult = await initProject({
		cwd: process.cwd(),
		user: {userId, userName},
	});
	if (isFail(initResult)) return initResult;

	let successMessage = 'Project initialized!';
	for (const warning of initResult.value.warnings) {
		successMessage += ` Warn: ${warning}`;
	}

	// 16. boot app from the same default events.
	// Do not persist again here; authoritative persistence already happened
	// in the state branch worktree above.
	const materializeResults = materializeAll(initResult.value.defaultEvents);
	const failures = materializeResults.filter(isFail);

	if (failures.length > 0) {
		return failAt(16, failures.map(f => f.message).join('\n'));
	}
	const stateResult = getSafeState();
	if (isFail(stateResult)) return failAt(16, stateResult.message);

	const {rootNodeId, nodes} = stateResult.value;
	const rootNode = nodes[rootNodeId];

	if (!rootNode) {
		return failAt(16, 'Unable to resolve initialized root node');
	}

	navigationUtils.navigate({
		contextNode: rootNode,
		selectedIndex: 0,
	});

	patchState({
		hasProjectDefinition: true,
		mode: Mode.DEFAULT,
	});

	return succeeded(successMessage, null);
};
