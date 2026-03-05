import {CmdResults} from '../../command-line/cmd-utils.js';
import {getCommandIntent} from '../../command-line/command-line-sequence-intent.js';
import {commands} from '../../command-line/commands.js';
import {ActionEntry} from '../../model/action-map.model.js';
import {
	clearCmd,
	getCmdState,
	updateCmdHistory,
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
	const actionMeta = commands.find(x => x.intent === intent);
	const actionResult = actionMeta?.action?.(ctx, actionMeta, {command, value});
	updateCmdHistory();
	clearCmd();
	if (actionResult === CmdResults.Succeed && actionMeta?.onSuccess) {
		actionMeta.onSuccess?.action?.(ctx, actionMeta, {command, value});
	}
	if (actionResult === CmdResults.Fail && actionMeta?.onFail) {
		actionMeta.onFail?.action?.(ctx, actionMeta, {command, value});
	}
	return;
};
