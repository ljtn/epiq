import {ulid} from 'ulid';
import {createIssueEvents} from '../../event/common-events.js';
import {
	materializeAndPersist,
	materializeAndPersistAll,
} from '../../event/event-materialize-and-persist.js';
import {AppEvent} from '../../event/event.model.js';
import {findAncestor, nodeRepo} from '../../repository/node-repo.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {setConfig} from '../config/epiq-config.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {Filter, findInBreadCrumb} from '../model/app-state.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {getCmdArg, getCmdState} from '../state/cmd.state.js';
import {patchSettingsState} from '../state/settings.state.js';
import {
	getRenderedChildren,
	getState,
	patchState,
	updateState,
} from '../state/state.js';
import {CmdIntent} from './command-meta.js';
import {
	CmdKeywords,
	cmdResult,
	cmdValidity,
	failed,
	isFail,
	noResult,
	succeeded,
} from './command-types.js';
import {getCmdModifiers} from './command-modifiers.js';

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
			const child = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!child) return failed('Unable to resolve child to delete');

			return materializeAndPersist({
				action: 'delete.node',
				payload: {
					id: child.id,
				},
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Filter,
		mode: Mode.COMMAND_LINE,
		action: () => {
			logger.debug(1);
			const {modifier, inputString} = getCmdState().commandMeta;
			const regex = /(!=|=)/; // Matches "=" and "!="
			const [filterTarget, _filterOperator] = modifier.split(regex);
			const isValidModifier = (val: string): val is Filter['target'] =>
				getCmdModifiers(CmdKeywords.FILTER)
					.map(x => x.split(regex)[0])
					.includes(val);

			logger.debug(filterTarget);
			if (!filterTarget || !isValidModifier(filterTarget))
				return failed('Invalid filter modifier');
			const filter: Filter = {
				target: filterTarget,
				operator: '=',
				value: inputString,
			};
			logger.debug(' hehe');
			updateState(s => ({
				...s,
				filters: modifier === 'clear' ? [] : [...s.filters, filter],
				mode: Mode.DEFAULT,
			}));
			return succeeded('Viewing help', null);
		},
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
		intent: CmdIntent.SetUserName,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userName = getCmdArg()?.trim();

			if (!userName) return failed('No username provided');

			const persistResult = setConfig({userName});
			if (isFail(persistResult)) return persistResult;

			patchSettingsState({
				userName,
			});

			patchState({mode: Mode.DEFAULT});

			return succeeded(`Username set to "${userName}"`, null);
		},
	},
	{
		intent: CmdIntent.SetEditor,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const editor = getCmdArg()?.trim();

			if (!editor) {
				return failed('No editor provided');
			}

			const persistResult = setConfig({preferredEditor: editor});
			if (isFail(persistResult)) return persistResult;

			patchSettingsState({
				preferredEditor: editor,
			});

			patchState({mode: Mode.DEFAULT});

			return succeeded(`Editor configuration set to "${editor}"`, null);
		},
	},
	{
		intent: CmdIntent.NewItem,
		mode: Mode.COMMAND_LINE,
		action: (_cmdAction, cmdState) => {
			if (!cmdState.inputString) {
				return failed(`provide a name for your ${cmdState.modifier}`);
			}

			const createAndNavigate = (
				event: AppEvent<
					| 'add.workspace'
					| 'add.board'
					| 'add.swimlane'
					| 'add.issue'
					| 'add.field'
				>,
			) => {
				const result = materializeAndPersist(event);
				if (isFail(result)) return result;

				const createdNode = nodeRepo.getNode(result.data.id);
				if (!createdNode) return failed('Created node not found');

				if (!createdNode.parentNodeId) return result;

				const parentNode = nodeRepo.getNode(createdNode.parentNodeId);
				if (!parentNode) return failed('Parent node not found');

				navigationUtils.navigate({
					currentNode: parentNode,
					selectedIndex: nodeRepo
						.getSiblings(createdNode.parentNodeId)
						.findIndex(({id}) => id === createdNode.id),
				});

				return result;
			};

			if (cmdState.modifier === 'board') {
				const {rootNodeId} = getState();
				const workspace = nodeRepo.getNode<'WORKSPACE'>(rootNodeId);
				if (!workspace) return failed('Workspace not found');

				return createAndNavigate({
					action: 'add.board',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parent: workspace.id,
					},
				});
			}

			if (cmdState.modifier === 'swimlane') {
				const boardResult = findInBreadCrumb(getState().breadCrumb, 'BOARD');
				if (isFail(boardResult))
					return failed('Unable to add swimlane in this context');

				return createAndNavigate({
					action: 'add.swimlane',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parent: boardResult.data.id,
					},
				});
			}

			if (cmdState.modifier === 'issue') {
				const swimlaneResult = findInBreadCrumb(
					getState().breadCrumb,
					'SWIMLANE',
				);
				if (isFail(swimlaneResult))
					return failed('Unable to add issue in this context');

				const issueEvents = createIssueEvents({
					name: cmdState.inputString,
					parent: swimlaneResult.data.id,
				});

				const issueResults = materializeAndPersistAll(issueEvents);

				if (
					issueResults.some(x =>
						isFail<NavNode<'TICKET'> | NavNode<'FIELD'>>(x),
					)
				) {
					return failed(
						'Issue create failed: ' +
							issueResults
								.filter(x => isFail<NavNode<'TICKET'> | NavNode<'FIELD'>>(x))
								.map(r => r.message)
								.join(', '),
					);
				}

				const issueResult = issueResults[0];
				if (!issueResult || isFail(issueResult))
					return failed('Issue creation failed');

				navigationUtils.navigate({
					currentNode: swimlaneResult.data,
					selectedIndex: nodeRepo
						.getSiblings(issueResult.data.parentNodeId!)
						.findIndex(({id}) => id === issueResult.data.id),
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
			logger.debug('1');

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
			const node = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!node) return failed('Missing node');

			const newName = getCmdArg();
			if (!newName) return failed('Provide a new name');

			return materializeAndPersist({
				action: 'edit.title',
				payload: {id: node.id, val: newName},
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
			const selected = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!selected) return failed('Invalid tag target');

			const ticketResult = findAncestor(selected.id, 'TICKET');
			if (isFail(ticketResult))
				return failed('Unable to tag issue in this context');

			const ticket = ticketResult.data;
			const existingTag = findTagByName(name);

			let tagId: string;

			if (existingTag) {
				tagId = existingTag.id;
			} else {
				const newTagId = ulid();
				const createResult = materializeAndPersist({
					action: 'create.tag',
					payload: {
						id: newTagId,
						name,
					},
				});

				if (isFail(createResult)) return createResult;
				tagId = createResult.data;
			}

			const tagsField = nodeRepo.getFieldByTitle(ticket.id, 'Tags');
			if (!tagsField) return failed('Unable to locate tags field');

			const alreadyTagged = getRenderedChildren(tagsField.id).some(
				child => child.props?.value === tagId,
			);

			if (alreadyTagged) return failed('Already tagged with that tag');

			return materializeAndPersist({
				action: 'tag.issue',
				payload: {
					id: ulid(),
					target: ticket.id,
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
			const selected = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!selected) return failed('Invalid assign target');

			const ticketResult = findAncestor(selected.id, 'TICKET');
			if (isFail(ticketResult))
				return failed('Unable to assign issue in this context');

			const ticket = ticketResult.data;
			const existingContributor = findContributorByName(name);

			let contributorId: string;

			if (existingContributor) {
				contributorId = existingContributor.id;
			} else {
				const newContributorId = ulid();
				const createResult = materializeAndPersist({
					action: 'create.contributor',
					payload: {
						id: newContributorId,
						name,
					},
				});

				if (isFail(createResult)) return createResult;
				contributorId = createResult.data;
			}

			const assigneesField = nodeRepo.getFieldByTitle(ticket.id, 'Assignees');
			if (!assigneesField) return failed('Unable to locate assignees field');

			const alreadyAssigned = getRenderedChildren(assigneesField.id).some(
				child => child.props?.value === contributorId,
			);

			if (alreadyAssigned) return failed('Assignee already assigned');

			return materializeAndPersist({
				action: 'assign.issue',
				payload: {
					id: ulid(),
					target: ticket.id,
					contributor: contributorId,
				},
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
];
