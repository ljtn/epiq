import {getCommandIntent} from '../../command-line/command-intent.js';
import {
	cmdResult,
	cmdValidity,
	isFail,
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
) => {
	const {
		commandMeta: {command, validity, modifier, inputString},
	} = getCmdState();
	if (!command) return;
	const intent = getCommandIntent(command);

	commandPending();

	if (validity === cmdValidity.Invalid) {
		// Handled by info hints
		return;
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
	return;
};
