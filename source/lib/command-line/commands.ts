import {ulid} from 'ulid';
import {findAncestor, nodeRepo} from '../actions/add-item/node-repo.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {findInBreadCrumb} from '../model/app-state.model.js';
import {getCmdArg, getCmdState} from '../state/cmd.state.js';
import {getState, patchState, updateState} from '../state/state.js';
import {CmdIntent} from './command-meta.js';
import {
	cmdResult,
	cmdValidity,
	failed,
	noResult,
	succeeded,
} from './command-types.js';
import {materializeAndPersist} from '../../event/event-materialize-and-persist.js';

const findTagByName = (name: string) =>
	Object.values(getState().tags).find(tag => tag.name === name);

const findContributorByName = (name: string) =>
	Object.values(getState().contributors).find(
		contributor => contributor.name === name,
	);

export const commands: CommandLineActionEntry[] = [
	{
		intent: CmdIntent.Delete,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {currentNode, selectedIndex} = getState();
			const childId = currentNode.children[selectedIndex];
			if (!childId) return failed('Unable to resolve child to delete');

			return materializeAndPersist({
				action: 'delete.node',
				payload: {
					parentId: currentNode.id,
					id: childId,
				},
			});
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
			if (!cmdState.inputString) {
				return failed(`provide a name for your ${cmdState.modifier}`);
			}

			if (cmdState.modifier === 'board') {
				const {rootNodeId} = getState();
				const workspace = nodeRepo.getNode<'WORKSPACE'>(rootNodeId);
				if (!workspace) return failed('Workspace not found');

				return materializeAndPersist({
					action: 'add.board',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parentId: workspace.id,
					},
				});
			}

			if (cmdState.modifier === 'swimlane') {
				const board = findInBreadCrumb(getState().breadCrumb, 'BOARD');
				if (!board) return failed('Unable to add swimlane in this context');

				return materializeAndPersist({
					action: 'add.swimlane',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parentId: board.id,
					},
				});
			}

			if (cmdState.modifier === 'issue') {
				const swimlane = findInBreadCrumb(getState().breadCrumb, 'SWIMLANE');
				if (!swimlane) return failed('Unable to add issue in this context');

				const result = materializeAndPersist({
					action: 'add.issue',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parentId: swimlane.id,
					},
				});

				if (result.result !== 'success') {
					return result;
				}

				navigationUtils.navigate({
					currentNode: swimlane,
					selectedIndex: swimlane.children.length,
				});

				return result;
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
			const {currentNode, selectedIndex} = getState();
			const nodeId = currentNode.children[selectedIndex];
			if (!nodeId) return failed('Missing node id');
			const node = nodeRepo.getNode(nodeId);
			if (!node) return failed('Missing node');

			const newName = getCmdArg();
			if (!newName) return failed('Provide a new name');

			return materializeAndPersist({
				action: 'edit.title',
				payload: {id: node.id, value: newName},
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.TagTicket,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {modifier, inputString} = getCmdState().commandMeta;
			const name = modifier || inputString;
			if (!name) return failed('Provide a tag');

			const {selectedIndex, currentNode} = getState();
			const selectedId = currentNode.children[selectedIndex];
			if (!selectedId) return failed('Selection node not found');
			const ticket = findAncestor(selectedId, 'TICKET').data;
			if (!ticket) return failed('Unable to tag issue in this context');

			const existingTag = findTagByName(name);

			let tagId: string | null = ulid();
			if (!existingTag) {
				tagId = materializeAndPersist({
					action: 'tag.create',
					payload: {
						id: tagId,
						name,
					},
				}).data;
			}
			logger.debug('existingTag', existingTag, tagId);
			if (!tagId) return failed('Unable to resolve tag id');

			return materializeAndPersist({
				action: 'issue.tag',
				payload: {
					targetId: selectedId,
					tagId,
				},
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.AssignUserToTicket,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {modifier, inputString} = getCmdState().commandMeta;
			const name = modifier || inputString;
			if (!name) return failed('Provide an assignee');

			const {selectedIndex, currentNode} = getState();
			const selectedId = currentNode.children[selectedIndex];
			if (!selectedId) return failed('Selection node not found');
			const ticket = findAncestor(selectedId, 'TICKET').data;
			if (!ticket) return failed('Unable to tag issue in this context');

			const existingContributor = findContributorByName(name);

			let contributorId: string | null = ulid();
			if (!existingContributor) {
				contributorId = materializeAndPersist({
					action: 'contributor.create',
					payload: {
						id: contributorId,
						name,
					},
				}).data;
			}
			if (!contributorId) return failed('Unable to resolve contributor id');

			return materializeAndPersist({
				action: 'issue.assign',
				payload: {
					targetId: ticket.id,
					contributorId: contributorId,
				},
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
];
