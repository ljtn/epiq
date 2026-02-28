import {getCommandIntent} from '../../navigation/command-line/command-line-sequence-intent.js';
import {commands} from '../../navigation/command-line/commands.js';
import {ActionEntry} from '../../navigation/model/action-map.model.js';
import {
	clearCmd,
	getCmdValue,
	updateCmdHistory,
} from '../../navigation/state/cmd.state.js';

export const onConfirmCommandLineSequenceInput = (
	...args: Parameters<NonNullable<ActionEntry['action']>>
) => {
	const commandSequence = getCmdValue();
	const [ctx] = [...args];
	const [firstItem, ...rest] = commandSequence.split(' ');
	const command = (firstItem || '').trim();
	const value = rest.join(' ').trim();
	if (!command) return;
	const intent = getCommandIntent(command);
	const actionMeta = commands.find(x => x.intent === intent);
	actionMeta?.action?.(ctx, actionMeta, {command, value});
	updateCmdHistory();
	clearCmd();
	return;
};
