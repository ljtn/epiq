import {getCommandIntent} from '../../command-line/command-intent.js';
import {
	cmdResult,
	cmdValidity,
	failed,
	isFail,
	Result,
} from '../../command-line/command-types.js';
import {commands} from '../../command-line/commands.js';
import {ActionEntry} from '../../model/action-map.model.js';
import {
	cmdResultToValidationState,
	commandConfirmed,
	commandPending,
	getCmdState,
} from '../../state/cmd.state.js';

export const onConfirmCommandLineSequenceInput = (
	..._args: Parameters<NonNullable<ActionEntry['action']>>
): Result => {
	const {
		commandMeta: {command, validity, modifier, inputString},
	} = getCmdState();
	if (!command) return failed('No command to confirm');
	const intent = getCommandIntent(command);

	commandPending();

	if (validity === cmdValidity.Invalid) {
		// Handled by info hints
		return failed('Invalid command');
	}

	const actionMeta = commands.find(c => c.intent === intent);
	if (!actionMeta) {
		return cmdResultToValidationState({
			result: cmdResult.Fail,
			message: 'Command not found',
			data: null,
		});
	}

	const commandResult = actionMeta.action(actionMeta, {
		command,
		inputString,
		modifier,
	});

	if (isFail(commandResult)) return cmdResultToValidationState(commandResult);

	commandConfirmed();
	actionMeta?.onSuccess?.();
	return cmdResultToValidationState(commandResult);
};
