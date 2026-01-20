import {commandLineSequenceActions} from '../../command-line/command-line-sequence-actions.js';
import {getCommandLineIntent} from '../../command-line/command-line-sequence-intent.js';
import {ActionEntry} from '../../model/action-map.model.js';
import {
	clearCommandLine,
	getCommandLineInput,
	updateCommandHistory,
} from '../../state/command-line.state.js';

export const onConfirmCommandLineSequenceInput = (
	...args: Parameters<NonNullable<ActionEntry['action']>>
) => {
	const commandSequence = getCommandLineInput();
	const [ctx] = [...args];
	const [firstItem, ...rest] = commandSequence.split(' ');
	const command = (firstItem || '').trim();
	const value = rest.join(' ').trim();
	if (!command) return;
	const intent = getCommandLineIntent(command);
	const actionMeta = commandLineSequenceActions.find(x => x.intent === intent);
	actionMeta?.action?.(ctx, actionMeta, {command, value});
	updateCommandHistory();
	clearCommandLine();
	return;
};
