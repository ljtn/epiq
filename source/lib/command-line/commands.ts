import {
	addBoard,
	addSwimlane,
	addTicket,
} from '../actions/add-item/add-item-actions.js';
import {navigator} from '../actions/default/navigation-action-utils.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {getCmdArg} from '../state/cmd.state.js';
import {appState, patchState} from '../state/state.js';
import {storageManager} from '../storage/storage-manager.js';
import {nodeMapper} from '../utils/node-mapper.js';
import {CmdIntent} from './command-line-sequence-intent.js';
function findNavNode(root: any, id: string): any | null {
	if (!root) return null;
	if (root.id === id) return root;
	for (const child of root.children ?? []) {
		const hit = findNavNode(child, id);
		if (hit) return hit;
	}
	return null;
}

export const commands: CommandLineActionEntry[] = [
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

			const current = appState.currentNode;
			if (!current) return;

			const targetNode = current.children[appState.selectedIndex];
			if (!targetNode) return;

			const nodeType = nodeMapper.contextToNodeTypeMap(targetNode.context);
			if (!nodeType) return;

			const result = storageManager.renameNodeTitle(
				nodeType,
				targetNode.id,
				newName,
			);
			if (!result) return;

			const updatedNode = result.snap.nodes[nodeType][result.nodeId];
			if (!updatedNode) return;

			const newRootDisk =
				result.snap.nodes.workspaces[result.snap.rootWorkspaceId];
			if (!newRootDisk) return;
			const newRootNav = nodeMapper.toWorkspace(newRootDisk); // whatever your root mapper is
			if (!newRootNav) return;

			const updatedCurrent = findNavNode(newRootNav, current.id) ?? current;

			patchState({
				rootNode: newRootNav,
				currentNode: updatedCurrent,
				mode: Mode.DEFAULT,
			});
			navigator.navigate({
				currentNode: updatedCurrent,
				selectedIndex: appState.selectedIndex,
			});
			// navigator.enterChildNode();
		},
	},
];
