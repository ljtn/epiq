import {
	addBoard,
	addSwimlane,
	addTicket,
} from '../actions/add-item/add-item-actions.js';
import {navigator} from '../actions/default/navigation-action-utils.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {nodeRepository} from '../repository/node-repository.js';
import {getCmdArg, getCmdState} from '../state/cmd.state.js';
import {getState, patchState, updateState} from '../state/state.js';
import {storage} from '../storage/storage.js';
import {nodeMapper} from '../utils/node-mapper.js';
import {CmdIntent} from './command-meta.js';
import {cmdResult, cmdValidity} from './command-types.js';

export const commands: CommandLineActionEntry[] = [
	{
		intent: CmdIntent.Delete,
		mode: Mode.COMMAND_LINE,
		action: (_, _2) => {
			const {currentNode: currentNode, selectedIndex} = getState();
			const child = currentNode.children.find((_, i) => i === selectedIndex);
			if (!child) return logger.error('Unable to resolve child to delete');
			nodeRepository.deleteNode(currentNode.id, child.id);
			return {result: cmdResult.Success};
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.ViewHelp,
		mode: Mode.COMMAND_LINE,
		action: () => patchState({mode: Mode.HELP}),
	},
	{
		intent: CmdIntent.NewItem,
		mode: Mode.COMMAND_LINE,
		action: (cmdAction, cmdState) => {
			if (!cmdState.inputString) {
				return {
					result: cmdResult.Fail,
					message: `provide a name for your ${cmdState.modifier}`,
				};
			}
			if (cmdState.modifier === 'board') {
				return addBoard(cmdAction, cmdState);
			} else if (cmdState.modifier === 'swimlane') {
				return addSwimlane(cmdAction, cmdState);
			} else if (cmdState.modifier === 'issue') {
				return addTicket(cmdAction, cmdState);
			}
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.SetView,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {commandMeta} = getCmdState();
			if (commandMeta.validity === cmdValidity.Invalid) {
				return {result: cmdResult.Fail};
			}
			return updateState(s => ({
				...s,
				viewMode:
					commandMeta.modifier === 'wide'
						? 'wide'
						: commandMeta.modifier === 'dense'
						? 'dense'
						: s.viewMode,
			}));
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Rename,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const newName = getCmdArg();
			if (!newName) return;

			const state = getState();
			const current = state.currentNode;
			if (!current) return;

			const targetNode = current.children[state.selectedIndex];
			if (!targetNode) return;

			const nodeType = nodeMapper.contextToNodeTypeMap(targetNode.context);
			if (!nodeType) return;

			// now returns only nodeId (persisted to disk)
			const nodeId = storage.renameNodeTitle(targetNode.id, newName);
			if (!nodeId) return;

			// reload from disk and remap (source of truth)
			const workspaceDisk = storage.loadWorkspace();
			if (!workspaceDisk) return;

			const newRootNav = nodeMapper.toWorkspace(workspaceDisk);
			if (!newRootNav) return;

			patchState({
				rootNode: newRootNav,
			});

			// re-sync breadcrumb/currentNode via navigator (uses ids)
			navigator.navigate({
				currentNode: current, // id-based lookup will resolve to tree instance
				selectedIndex: state.selectedIndex,
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.TagTicket,
		mode: Mode.COMMAND_LINE,
		action: (..._args) => {
			const {modifier, inputString} = getCmdState().commandMeta;
			let name = modifier;
			if (!name) {
				name = inputString;
				logger.info('Unknown tag, creating new tag');
			}
			return nodeRepository.addTag(name);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.AssignUserToTicket,
		mode: Mode.COMMAND_LINE,
		action: (..._args) => {
			const {modifier, inputString} = getCmdState().commandMeta;
			let name = modifier;
			if (!name) {
				name = inputString;
				logger.info('Unknown assignee, creating new assignee');
			}
			return nodeRepository.assignUser(name);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
];
