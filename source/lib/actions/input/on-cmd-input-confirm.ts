import {getCommandIntent} from '../../command-line/command-intent.js';
import {
	cmdResult,
	cmdValidity,
	failed,
	isFail,
	Result,
} from '../../command-line/command-types.js';
import {commands} from '../../command-line/commands.js';
import {
	cmdResultToValidationState,
	commandConfirmed,
	commandPending,
	getCmdState,
} from '../../state/cmd.state.js';

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

	const actionMeta = commands
		.filter(c => isForceExecutedBySystem || c.systemOnly !== true)
		.find(c => c.intent === intent);

	if (!actionMeta) {
		return cmdResultToValidationState({
			result: cmdResult.Fail,
			message: 'Command not found',
			data: null,
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
