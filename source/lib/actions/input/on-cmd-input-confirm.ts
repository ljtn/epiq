import {getCommandIntent} from '../../command-line/command-line-sequence-intent.js';
import {commands} from '../../command-line/commands.js';
import {ActionEntry} from '../../model/action-map.model.js';
import {
	getCmdState,
	isInvalidCommand,
	commandConfirmed,
	overrideValidationResult,
	commandPending,
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
	const result = actionMeta?.action?.(ctx, actionMeta, {command, value});

	if (result?.result === 'fail') return overrideValidationResult(result);

	commandConfirmed();
	actionMeta?.onSuccess?.();
	return;
};
