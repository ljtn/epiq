import {getCommandIntent} from '../../command-line/command-intent.js';
import {cmdResult} from '../../command-line/command-types.js';
import {commands} from '../../command-line/commands.js';
import {ActionEntry} from '../../model/action-map.model.js';
import {
	commandConfirmed,
	commandPending,
	getCmdState,
	isInvalidCommand,
	cmdResultToValidationState,
} from '../../state/cmd.state.js';

export const onConfirmCommandLineSequenceInput = (
	...args: Parameters<NonNullable<ActionEntry['action']>>
) => {
	const commandSequence = getCmdState().value;
	const [ctx] = [...args];
	const [firstItem, ...rest] = commandSequence.split(' ');
	const command = (firstItem || '').trim();
	const value = rest.join(' ').trim();
	if (!command) return;
	const intent = getCommandIntent(command);

	commandPending();
	if (isInvalidCommand()) {
		// Handled by info hints
		return;
	}

	const actionMeta = commands.find(x => x.intent === intent);
	const commandResult = actionMeta?.action?.(ctx, actionMeta, {command, value});

	if (commandResult && commandResult.result === cmdResult.Fail) {
		return cmdResultToValidationState(commandResult);
	}

	commandConfirmed();
	actionMeta?.onSuccess?.();
	return;
};
