import {playEvent} from '../../event/play.event.js';
import {nodeRepo} from '../actions/add-item/node-repo.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {findInBreadCrumb} from '../model/app-state.model.js';
import {nodeRepository} from '../repository/node-repository.js';
import {getCmdArg, getCmdState} from '../state/cmd.state.js';
import {getState, patchState, updateState} from '../state/state.js';
import {storage} from '../storage/storage.js';
import {nodeMapper} from '../utils/node-mapper.js';
import {CmdIntent} from './command-meta.js';
import {
	cmdResult,
	cmdValidity,
	failed,
	noResult,
	succeeded,
} from './command-types.js';

export const commands: CommandLineActionEntry[] = [
	{
		intent: CmdIntent.Delete,
		mode: Mode.COMMAND_LINE,
		action: (_, _2) => {
			const {currentNode: currentNode, selectedIndex} = getState();
			const childId = currentNode.children.find((_, i) => i === selectedIndex);
			if (!childId) {
				return failed('Unable to resolve child to delete');
			}
			nodeRepository.deleteNode(currentNode.id, childId);
			return succeeded('Deleted node', null);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.ViewHelp,
		mode: Mode.COMMAND_LINE,
		action: () => {
			patchState({mode: Mode.HELP});
			return succeeded('Viewing help', null);
		},
	},
	{
		intent: CmdIntent.NewItem,
		mode: Mode.COMMAND_LINE,
		action: (_cmdAction, cmdState) => {
			if (!cmdState.inputString)
				return failed(`provide a name for your ${cmdState.modifier}`);

			if (cmdState.modifier === 'board') {
				const {rootNodeId} = getState();
				const workspace = nodeRepo.getNode<'WORKSPACE'>(rootNodeId);
				if (!workspace) return failed('Workspace not found');

				return playEvent({
					action: 'add.board',
					payload: {name: cmdState.inputString, parent: workspace},
				});
			} else if (cmdState.modifier === 'swimlane') {
				const board = findInBreadCrumb(getState().breadCrumb, 'BOARD');
				if (!board) return failed('Unable to add swimlane in this context');

				return playEvent({
					action: 'add.swimlane',
					payload: {name: cmdState.inputString, parent: board},
				});
			} else if (cmdState.modifier === 'issue') {
				const swimlane = findInBreadCrumb(getState().breadCrumb, 'SWIMLANE');
				if (!swimlane) return failed('Unable to add issue in this context');

				return playEvent({
					action: 'add.issue',
					payload: {name: cmdState.inputString, parent: swimlane},
				});
			}

			return noResult();
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.SetView,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {commandMeta} = getCmdState();
			if (commandMeta.validity === cmdValidity.Invalid) {
				return failed('Invalid command ' + cmdResult);
			}
			updateState(s => ({
				...s,
				viewMode:
					commandMeta.modifier === 'wide'
						? 'wide'
						: commandMeta.modifier === 'dense'
						? 'dense'
						: s.viewMode,
			}));
			return succeeded('View set', null);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Rename,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const newName = getCmdArg();
			if (!newName) return failed('Provide a new name');

			const {nodes, currentNode, selectedIndex} = getState();
			const current = currentNode;

			const childId = current.children[selectedIndex];
			if (!childId) return failed('Rename failed');

			const targetNode = nodes[childId];
			if (!targetNode) return failed('Rename failed');

			const nodeType = nodeMapper.contextToNodeTypeMap(targetNode.context);
			if (!nodeType) return failed('Rename failed');

			// now returns only nodeId (persisted to disk)
			const nodeId = storage.renameNodeTitle(targetNode.id, newName);
			if (!nodeId) return failed('Rename failed');

			// reload from disk and remap (source of truth)
			const workspaceDisk = storage.loadWorkspace();
			if (!workspaceDisk) return failed('Rename failed');

			const newRootNav = nodeMapper.toWorkspace(workspaceDisk);
			if (!newRootNav) return failed('Rename failed');

			patchState({
				rootNodeId: newRootNav.id,
			});

			navigationUtils.navigate({
				currentNode: current, // id-based lookup will resolve to tree instance
				selectedIndex: selectedIndex,
			});
			return succeeded('Renamed node', newName);
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
