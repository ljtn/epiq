import {getCommandIntent} from '../../command-line/command-line-sequence-intent.js';
import {commands} from '../../command-line/commands.js';
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
	const intent = getCommandIntent(command);
	const actionMeta = commands.find(x => x.intent === intent);
	actionMeta?.action?.(ctx, actionMeta, {command, value});
	updateCommandHistory();
	clearCommandLine();
	return;
};
