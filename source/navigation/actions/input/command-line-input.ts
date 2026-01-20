import {commandLineActions} from '../../command-line/command-line-actions.js';
import {getCommandLineIntent} from '../../command-line/command-line-intent.js';
import {ActionEntry} from '../../model/action-map.model.js';

export const onConfirmCommandLineInput = (
	...args: [...Parameters<NonNullable<ActionEntry['action']>>, string]
) => {
	const [ctx, , , commandSequence] = [...args];
	const [firstItem, ...rest] = commandSequence.split(' ');
	const command = (firstItem || '').trim();
	const value = rest.join(' ').trim();
	if (!command) return;
	if (!value) return; // Consider helping with auto completion, or showing a hint?
	const intent = getCommandLineIntent(command);
	const actionMeta = commandLineActions.find(x => x.intent === intent);
	return actionMeta?.action?.(ctx, actionMeta, {command, value});
};
