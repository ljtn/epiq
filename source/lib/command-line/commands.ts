import {
	addBoard,
	addSwimlane,
	addTicket,
} from '../actions/add-item/add-item-actions.js';
import {navigator} from '../actions/default/navigation-action-utils.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {getCmdArg} from '../state/cmd.state.js';
import {getState, patchState} from '../state/state.js';
import {storageManager} from '../storage/storage-manager.js';
import {nodeMapper} from '../utils/node-mapper.js';
import {CmdIntent} from './command-line-sequence-intent.js';

export const commands: CommandLineActionEntry[] = [
	{
		intent: CmdIntent.Delete,
		mode: Mode.COMMAND_LINE,
		action: (_, _2, {value}) => {
			if (value !== 'confirm') return;
			const {currentNode, selectedIndex} = getState();
			const child = currentNode.children.find((_, i) => i === selectedIndex);
			logger.info(child?.id);
			if (!child) return logger.error('Unable to resolve child to delete');
			storageManager.unlinkChild(currentNode.id, child.id);
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
			const nodeId = storageManager.renameNodeTitle(
				nodeType,
				targetNode.id,
				newName,
			);
			if (!nodeId) return;

			// reload from disk and remap (source of truth)
			const workspaceDisk = storageManager.loadWorkspace();
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
];
