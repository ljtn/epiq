import {commandLineActions} from '../../command-line/command-line-actions.js';
import {getCommandLineIntent} from '../../command-line/command-line-intent.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {navigationState, patchState, updateState} from '../../state/state.js';
import {KeyIntent} from '../../utils/key-intent.js';
export const inputActions: ActionEntry[] = [
	{
		intent: KeyIntent.ToggleHelp,
		mode: Mode.HELP,
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
		},
	},
	{
		intent: KeyIntent.Confirm,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			onConfirmCommandLineInput(...args, navigationState.commandLineInput);
		},
	},
	{
		intent: KeyIntent.CaptureInput,
		mode: Mode.COMMAND_LINE,
		action: (_1, _2, {sequence}) => {
			updateState(s => ({
				...s,
				commandLineInput: s.commandLineInput + sequence,
			}));
		},
	},
	{
		intent: KeyIntent.EraseInput,
		mode: Mode.COMMAND_LINE,
		action: () => {
			updateState(s => ({
				...s,
				commandLineInput: s.commandLineInput.slice(0, -1),
			}));
		},
	},
];

const onConfirmCommandLineInput = (
	...args: [...Parameters<NonNullable<ActionEntry['action']>>, string]
) => {
	const [ctx, , , commandSequence] = [...args];
	const intent = getCommandLineIntent(commandSequence);
	const actionMeta = commandLineActions.find(x => x.intent === intent);

	return actionMeta?.action?.(ctx, actionMeta, commandSequence);
};
