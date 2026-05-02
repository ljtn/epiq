import {getCommandIntent} from '../../command-line/command-intent.js';
import {CommandIntent} from '../../command-line/command-meta.js';
import {
	resultStatuses,
	failed,
	isFail,
	Result,
} from '../../model/result-types.js';
import {cmdValidity} from '../../command-line/cmd-validity.js';
import {commands} from '../../command-line/commands.js';
import {
	cmdResultToValidationState,
	commandConfirmed,
	commandPending,
	getCmdState,
} from '../../state/cmd.state.js';
import {getState} from '../../state/state.js';

const READ_ONLY_COMMAND_INTENTS = new Set<CommandIntent>([
	'peek',
	'filter',
	'view-help',
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

	if (getState().readOnly && !READ_ONLY_COMMAND_INTENTS.has(intent)) {
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

	const commandResult = await actionMeta.action(actionMeta, {
		command,
		inputString,
		modifier,
	});

	if (isFail(commandResult)) {
		return cmdResultToValidationState(commandResult);
	}

	commandConfirmed({addToHistory: !isForceExecutedBySystem});
	actionMeta.onSuccess?.();

	return cmdResultToValidationState(commandResult);
};
