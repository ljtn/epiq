import {
	addBoard,
	addListItem,
	addSwimlane,
	addTicket,
} from '../actions/add-item/add-item-actions.js';
import {navigator} from '../actions/default/navigation-action-utils.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {nodeRepository} from '../repository/node-repository.js';
import {
	getCmdArg,
	getCmdState,
	getPrevCmd,
	setCmdInput,
} from '../state/cmd.state.js';
import {getState, patchState, updateState} from '../state/state.js';
import {storage} from '../storage/storage.js';
import {nodeMapper} from '../utils/node-mapper.js';
import {CmdIntent, CmdResults} from './cmd-utils.js';

export const commands: CommandLineActionEntry[] = [
	{
		intent: CmdIntent.Delete,
		mode: Mode.COMMAND_LINE,
		action: (_, _2) => {
			if (getCmdState().commandMeta.validationStatus === CmdResults.Fail) {
				return CmdResults.Fail;
			}
			const {currentNode: currentNode, selectedIndex} = getState();
			const child = currentNode.children.find((_, i) => i === selectedIndex);
			if (!child) return logger.error('Unable to resolve child to delete');
			nodeRepository.deleteNode(currentNode.id, child.id, child.context);
			return CmdResults.Succeed;
		},
		onFail: {
			mode: Mode.DEFAULT,
			intent: CmdIntent.None,
			action: () => {
				getPrevCmd();
				const value = getCmdState().value;
				const [firstWord] = value.split(' ');

				setCmdInput(() => firstWord + ' ' || '');
			},
		},
	},
	{
		intent: CmdIntent.ViewHelp,
		mode: Mode.COMMAND_LINE,
		action: () => patchState({mode: Mode.HELP}),
	},
	{
		intent: CmdIntent.AddBoard,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addBoard(...args);
			patchState({mode: Mode.DEFAULT});
		},
	},
	{
		intent: CmdIntent.AddSwimlane,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addSwimlane(...args);
			patchState({mode: Mode.DEFAULT});
		},
	},
	{
		intent: CmdIntent.AddTicket,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addTicket(...args);
			patchState({mode: Mode.DEFAULT});
		},
	},
	{
		intent: CmdIntent.SetView,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {commandMeta} = getCmdState();
			if (commandMeta.validationStatus === CmdResults.Fail) {
				return CmdResults.Fail;
			}
			return updateState(s => ({
				...s,
				mode: Mode.DEFAULT,
				viewMode:
					commandMeta.modifier === 'wide'
						? 'wide'
						: commandMeta.modifier === 'dense'
						? 'dense'
						: s.viewMode,
			}));
		},
	},
	{
		intent: CmdIntent.AddListItem,
		mode: Mode.COMMAND_LINE,
		action: (_, _2, {value}) => {
			addListItem(value);
			patchState({mode: Mode.DEFAULT});
		},
	},
	{
		intent: CmdIntent.Rename,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const newName = getCmdArg().trim();
			if (!newName) return;

			const state = getState();
			const current = state.currentNode;
			if (!current) return;

			const targetNode = current.children[state.selectedIndex];
			if (!targetNode) return;

			const nodeType = nodeMapper.contextToNodeTypeMap(targetNode.context);
			if (!nodeType) return;

			// now returns only nodeId (persisted to disk)
			const nodeId = storage.renameNodeTitle(nodeType, targetNode.id, newName);
			if (!nodeId) return;

			// reload from disk and remap (source of truth)
			const workspaceDisk = storage.loadWorkspace();
			if (!workspaceDisk) return;

			const newRootNav = nodeMapper.toWorkspace(workspaceDisk);
			if (!newRootNav) return;

			patchState({
				rootNode: newRootNav,
				mode: Mode.DEFAULT,
			});

			// re-sync breadcrumb/currentNode via navigator (uses ids)
			navigator.navigate({
				currentNode: current, // id-based lookup will resolve to tree instance
				selectedIndex: state.selectedIndex,
			});
		},
	},
	{
		intent: CmdIntent.TagTicket,
		mode: Mode.COMMAND_LINE,
		action: (..._args) => {
			const {modifier} = getCmdState().commandMeta;
			nodeRepository.addTag(modifier);
			patchState({mode: Mode.DEFAULT});
		},
	},
];
