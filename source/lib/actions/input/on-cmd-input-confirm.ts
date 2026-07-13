import {queueAutoSync} from '../../../git/auto-sync.js';
import {cmdValidity} from '../../command-line/cmd-validity.js';
import {getCommandIntent} from '../../command-line/command-intent.js';
import {CommandIntent} from '../../command-line/command-meta.js';
import {commands} from '../../command-line/commands.js';
import {
	failed,
	isFail,
	Result,
	resultStatuses,
} from '../../model/result-types.js';
import {
	cmdResultToValidationState,
	commandConfirmed,
	commandPending,
	getCmdState,
} from '../../state/cmd.state.js';
import {getSettingsState} from '../../state/settings.state.js';
import {getState} from '../../state/state.js';

const READ_ONLY_COMMAND_INTENTS = new Set<CommandIntent>([
	'peek',
	'replay',
	'filter',
	'view-help',
	'yank',
]);

export const onConfirmCommandLineSequenceInput = async ({
	isForceExecutedBySystem = false,
}: {isForceExecutedBySystem?: boolean} = {}): Promise<Result> => {
	const {
		commandMeta: {command, validity, modifier, inputString},
	} = getCmdState();

	if (!command) return failed('No command to confirm');

	if (!isForceExecutedBySystem && validity === cmdValidity.Invalid) {
		return failed('Invalid command');
	}

	const intent = getCommandIntent(command);

	commandPending();

	const {readOnly} = getState();

	if (readOnly && !READ_ONLY_COMMAND_INTENTS.has(intent)) {
		return cmdResultToValidationState({
			status: resultStatuses.Fail,
			message: 'Command not available in readonly state',
			value: null,
		});
	}

	const actionMeta = commands
		.filter(c => isForceExecutedBySystem || c.systemOnly !== true)
		.find(c => c.intent === intent);

	if (!actionMeta) {
		return cmdResultToValidationState({
			status: resultStatuses.Fail,
			message: 'Command not found',
			value: null,
		});
	}

	let commandResult: Result;

	try {
		commandResult = await actionMeta.action(actionMeta, {
			command,
			inputString,
			modifier,
		});
	} catch (error) {
		return cmdResultToValidationState({
			status: resultStatuses.Fail,
			message: error instanceof Error ? error.message : 'Command failed',
			value: null,
		});
	}

	if (isFail(commandResult)) {
		return cmdResultToValidationState(commandResult);
	}

	commandConfirmed({addToHistory: !isForceExecutedBySystem});
	actionMeta.onSuccess?.();

	if (getSettingsState().autoSync) {
		queueAutoSync();
	}

	return commandResult;
};
