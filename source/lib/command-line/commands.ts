import {ulid} from 'ulid';
import {openEditorOnText} from '../../editor/editor.js';
import {createIssueEvents} from '../../event/common-events.js';
import {getEventTime} from '../../event/date-utils.js';
import {
	hasPendingDefaultEvents,
	persistPendingDefaultEvents,
} from '../../event/event-boot.js';
import {loadMergedEvents, splitEventsAtTime} from '../../event/event-load.js';
import {
	materializeAndPersist,
	materializeAndPersistAll,
} from '../../event/event-materialize-and-persist.js';
import {materializeAll} from '../../event/event-materialize.js';
import {getPersistFileName, resolveActorId} from '../../event/event-persist.js';
import {AppEvent} from '../../event/event.model.js';
import {syncEpiqWithRemote} from '../../git/sync.js';
import {findAncestor, nodeRepo} from '../../repository/node-repo.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {
	getMovePendingState,
	moveChildWithinParent,
	moveNodeToSiblingContainer,
	setMovePendingState,
} from '../actions/move/move-actions-utils.js';
import {setConfig} from '../config/user-config.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {Filter, findInBreadCrumb} from '../model/app-state.model.js';
import {isTicketNode} from '../model/context.model.js';
import {getCmdArg, getCmdState, setCmdInput} from '../state/cmd.state.js';
import {getSettingsState, patchSettingsState} from '../state/settings.state.js';
import {
	getRenderedChildren,
	getState,
	patchState,
	resetState,
	updateState,
} from '../state/state.js';
import {CmdIntent} from './command-meta.js';
import {getCmdModifiers} from './command-modifiers.js';
import {
	CmdKeywords,
	cmdResult,
	cmdValidity,
	failed,
	isFail,
	noResult,
	Result,
	succeeded,
} from './command-types.js';
import {parsePeekDateInput} from './validate-date.js';

const findTagByName = (name: string) =>
	Object.values(getState().tags).find(tag => tag.name === name);

const findContributorByName = (name: string) =>
	Object.values(getState().contributors).find(
		contributor => contributor.name === name,
	);

export const commands: CommandLineActionEntry[] = [
	{
		systemOnly: true,
		intent: CmdIntent.Move,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			const {modifier} = getCmdState().commandMeta;

			const syncNavigationToPendingMove = (): Result<null> => {
				const pendingMoveState = getMovePendingState();
				if (!pendingMoveState) return failed('No pending move state');

				const movedNodeId = pendingMoveState.payload.id;
				const movedNode = getState().nodes[movedNodeId];
				if (!movedNode) return failed('Moved node not found');

				const parentId = pendingMoveState.payload.parent;
				const parent = getState().nodes[parentId];
				if (!parent) return failed('Move parent not found');

				const selectedIndex = getRenderedChildren(parentId).findIndex(
					x => x.id === movedNodeId,
				);
				if (selectedIndex === -1) {
					return failed('Moved node not found among rendered children');
				}

				navigationUtils.navigate({currentNode: parent, selectedIndex});
				return succeeded('Synchronized navigation to moved node', null);
			};

			const applyMovePreview = (moveResult: Result<unknown>): Result<null> => {
				if (isFail(moveResult)) return failed(moveResult.message);

				const navResult = syncNavigationToPendingMove();
				if (isFail(navResult)) return failed(navResult.message);

				return succeeded('Updated move preview', null);
			};

			const {currentNode, selectedIndex} = getState();
			const targetNode = getRenderedChildren(currentNode.id)[selectedIndex];

			if (!targetNode) {
				patchState({mode: Mode.DEFAULT});
				return failed('No move target');
			}

			if (modifier === 'start') {
				if (targetNode.readonly) return failed('Target node is read-only');
				if (selectedIndex === -1) return failed('No item selected');
				if (!targetNode.parentNodeId) return failed('Target has no parent');

				const siblings = getRenderedChildren(targetNode.parentNodeId);
				const currentIndex = siblings.findIndex(({id}) => id === targetNode.id);

				if (currentIndex === -1)
					return failed('Target not found among siblings');

				const previousSibling = siblings[currentIndex - 1];
				const nextSibling = siblings[currentIndex + 1];

				const pos =
					nextSibling != null
						? ({at: 'before', sibling: nextSibling.id} as const)
						: previousSibling != null
						? ({at: 'after', sibling: previousSibling.id} as const)
						: ({at: 'start'} as const);

				setMovePendingState({
					id: ulid(),
					userId,
					userName,
					action: 'move.node',
					payload: {
						id: targetNode.id,
						parent: targetNode.parentNodeId,
						pos,
					},
				});

				patchState({mode: Mode.MOVE});

				const navResult = syncNavigationToPendingMove();
				if (isFail(navResult)) return failed(navResult.message);

				return succeeded('Move initialized', null);
			}

			if (modifier === 'next') {
				patchState({mode: Mode.MOVE});
				return applyMovePreview(moveChildWithinParent(1));
			}

			if (modifier === 'previous') {
				patchState({mode: Mode.MOVE});
				return applyMovePreview(moveChildWithinParent(-1));
			}

			if (modifier === 'to-next') {
				patchState({mode: Mode.MOVE});
				return applyMovePreview(moveNodeToSiblingContainer(1));
			}

			if (modifier === 'to-previous') {
				patchState({mode: Mode.MOVE});
				return applyMovePreview(moveNodeToSiblingContainer(-1));
			}

			if (modifier === 'confirm') {
				patchState({mode: Mode.DEFAULT});

				const pendingMoveState = getMovePendingState();
				if (!pendingMoveState) return failed('No pending move to confirm');

				const result = materializeAndPersist(pendingMoveState);
				if (isFail(result)) return result;

				const navResult = syncNavigationToPendingMove();
				if (isFail(navResult)) return failed(navResult.message);

				setMovePendingState(null);
				return succeeded('Moved item', null);
			}

			if (modifier === 'cancel') {
				setMovePendingState(null);
				patchState({mode: Mode.DEFAULT});
				return succeeded('Cancelling move', null);
			}

			return failed('Invalid move modifier');
		},
	},
	{
		intent: CmdIntent.Delete,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			const {currentNode, selectedIndex} = getState();
			const child = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!child) return failed('Unable to resolve child to delete');

			return materializeAndPersist({
				id: ulid(),
				userId,
				userName,
				action: 'delete.node',
				payload: {
					id: child.id,
				},
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Edit,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			const issueResult = findInBreadCrumb(getState().breadCrumb, 'TICKET');
			if (isFail(issueResult)) return failed('Edit target must be an issue');

			const issueNode = issueResult.data;
			if (issueNode.readonly) return failed('Cannot edit readonly field');
			const {currentNode, selectedIndex} = getState();
			const selectedChild = getRenderedChildren(issueNode.id)[selectedIndex];
			if (!selectedChild) return failed('No selected field');

			const target = getRenderedChildren(currentNode.id)[selectedIndex];

			if (!target) return failed('No selected field');
			if (target.readonly) return failed('Cannot edit readonly field');

			const currentValue = target.props.value;

			if (typeof currentValue !== 'string') {
				return failed('Selected field is not editable text');
			}

			const editResult = openEditorOnText(currentValue);
			if (isFail(editResult)) return failed('Failed to edit field');

			const updatedValue = editResult.data;

			if (updatedValue === currentValue) {
				return succeeded('No changes made', null);
			}

			if (target.title === 'Description') {
				return materializeAndPersist({
					id: ulid(),
					userId,
					userName,
					action: 'edit.description',
					payload: {
						id: target.id,
						md: updatedValue,
					},
				});
			}

			if (target.title === 'Title') {
				return materializeAndPersist({
					id: ulid(),
					userId,
					userName,
					action: 'edit.title',
					payload: {
						id: target.id,
						name: updatedValue,
					},
				});
			}

			return failed(`Editing not supported for "${target.title}"`);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Filter,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {modifier, inputString} = getCmdState().commandMeta;
			const regex = /(!=|=)/;
			const [filterTarget, _filterOperator] = modifier.split(regex);
			const isValidModifier = (val: string): val is Filter['target'] =>
				getCmdModifiers(CmdKeywords.FILTER)
					.map(x => x.split(regex)[0])
					.includes(val);

			if (!filterTarget || !isValidModifier(filterTarget))
				return failed('Invalid filter modifier');

			const filter: Filter = {
				target: filterTarget,
				operator: '=',
				value: inputString.trim(),
			};

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
		intent: CmdIntent.CloseIssue,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			const {currentNode, selectedIndex} = getState();
			const target = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!target) return failed('Unable to close issue, no target found');
			if (!target.parentNodeId) return failed('No target parent found');
			if (!isTicketNode(target)) {
				return failed('Cannot close in this context');
			}

			const result = materializeAndPersist({
				id: ulid(),
				userId,
				userName,
				action: 'close.issue',
				payload: {id: target.id, parent: target.parentNodeId},
			});

			if (isFail(result)) return result;
			return succeeded('Viewing help', null);
		},
	},
	{
		intent: CmdIntent.ReopenIssue,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			const {currentNode, selectedIndex} = getState();
			const target = getRenderedChildren(currentNode.id)[selectedIndex];

			if (!target) return failed('Unable to reopen issue, no target found');

			const ticketResult =
				target.context === 'TICKET'
					? succeeded('Resolved ticket', target)
					: findAncestor(target.id, 'TICKET');

			if (isFail(ticketResult)) {
				return failed('Cannot reopen in this context');
			}

			const ticket = ticketResult.data;

			const result = materializeAndPersist({
				id: ulid(),
				userId,
				userName,
				action: 'reopen.issue',
				payload: {id: ticket.id},
			});

			if (isFail(result)) return result;

			return succeeded('Issue reopened', null);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.SetUserName,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {userId, preferredEditor, userName} = getSettingsState();
			const newUserName = getCmdArg()?.trim();
			if (!newUserName) return failed('No username provided');

			const resolvedUserName = newUserName ?? userName;
			const resolvedUserId = userId ?? ulid();

			if (!resolvedUserName || !resolvedUserId) {
				return failed('Unable to resolve user name or id');
			}

			const persistResult = setConfig({
				userName: resolvedUserName,
				userId: resolvedUserId,
				preferredEditor: preferredEditor ?? '',
			});
			if (isFail(persistResult)) return persistResult;

			patchSettingsState({
				userName: resolvedUserName,
				userId: resolvedUserId,
			});

			patchState({mode: Mode.DEFAULT});

			return succeeded(`Username set to "${newUserName}"`, null);
		},
	},
	{
		intent: CmdIntent.Init,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const result = persistPendingDefaultEvents();
			if (isFail(result)) return result;
			const {rootNodeId, nodes} = getState();
			navigationUtils.navigate({
				currentNode: nodes[rootNodeId],
				selectedIndex: 0,
			});
			return succeeded(`Project initialized`, null);
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
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			if (!cmdState.inputString) {
				return failed(`provide a name for your ${cmdState.modifier}`);
			}

			const {breadCrumb, currentNode, selectedIndex} = getState();

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

				const createdNode = nodeRepo.getNode(result.data.result.id);
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
					id: ulid(),
					userId,
					userName,
					action: 'add.board',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parent: workspace.id,
					},
				});
			}

			if (cmdState.modifier === 'swimlane') {
				const boardResult = findInBreadCrumb(breadCrumb, 'BOARD');
				if (isFail(boardResult))
					return failed('Unable to add swimlane in this context');

				return createAndNavigate({
					id: ulid(),
					userId,
					userName,
					action: 'add.swimlane',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parent: boardResult.data.id,
					},
				});
			}

			if (cmdState.modifier === 'issue') {
				const selectedNode = getRenderedChildren(currentNode.id)[selectedIndex];
				const swimlane =
					currentNode.context === 'SWIMLANE'
						? currentNode
						: currentNode.context === 'BOARD' &&
						  selectedNode?.context === 'SWIMLANE'
						? selectedNode
						: (() => {
								const swimlaneResult = findInBreadCrumb(breadCrumb, 'SWIMLANE');
								return isFail(swimlaneResult) ? null : swimlaneResult.data;
						  })();

				if (!swimlane) {
					return failed('Unable to add issue in this context');
				}

				const issueEvents = createIssueEvents({
					userId,
					userName,
					name: cmdState.inputString,
					parent: swimlane.id,
				});

				const issueResults = materializeAndPersistAll(issueEvents);

				if (issueResults.some(x => isFail(x))) {
					return failed(
						'Issue create failed: ' +
							issueResults
								.filter(isFail)
								.map(r => r.message)
								.filter(Boolean)
								.join(', '),
					);
				}

				const issueResult = issueResults[0];
				if (!issueResult || isFail(issueResult))
					return failed('Issue creation failed');

				const ticketId = issueEvents[0]?.payload.id;
				if (!ticketId) return failed('Unable to determine ticket id');

				navigationUtils.navigate({
					currentNode: swimlane,
					selectedIndex: nodeRepo
						.getSiblings(swimlane.id)
						.findIndex(({id}) => id === ticketId),
				});

				return succeeded('Issue created', null);
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
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			const {currentNode, selectedIndex} = getState();
			const node = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!node) return failed('Missing node');
			if (node.readonly) return failed('Cannot rename readonly node');

			const newName = getCmdArg();
			if (!newName) return failed('Provide a new name');

			return materializeAndPersist({
				id: ulid(),
				userId,
				userName,
				action: 'edit.title',
				payload: {id: node.id, name: newName},
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.TagTicket,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
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
					id: ulid(),
					userId,
					userName,
					action: 'create.tag',
					payload: {
						id: newTagId,
						name,
					},
				});

				if (isFail(createResult)) return createResult;
				tagId = createResult.data.result.id;
			}

			const tagsField = nodeRepo.getFieldByTitle(ticket.id, 'Tags');
			if (!tagsField) return failed('Unable to locate tags field');

			const alreadyTagged = getRenderedChildren(tagsField.id).some(
				child => child.props?.value === tagId,
			);

			if (alreadyTagged) return failed('Already tagged with that tag');

			return materializeAndPersist({
				id: ulid(),
				userId,
				userName,
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
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');
			const {userId, userName} = userRes.data;

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
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
					id: ulid(),
					userId,
					userName,
					action: 'create.contributor',
					payload: {
						id: newContributorId,
						name,
					},
				});

				if (isFail(createResult)) return createResult;
				contributorId = createResult.data.result.id;
			}

			const assigneesField = nodeRepo.getFieldByTitle(ticket.id, 'Assignees');
			if (!assigneesField) return failed('Unable to locate assignees field');

			const alreadyAssigned = getRenderedChildren(assigneesField.id).some(
				child => child.props?.value === contributorId,
			);

			if (alreadyAssigned) return failed('Assignee already assigned');

			return materializeAndPersist({
				id: ulid(),
				userId,
				userName,
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
	{
		intent: CmdIntent.Sync,
		mode: Mode.COMMAND_LINE,
		action: async () => {
			setCmdInput(() => '');

			patchState({
				syncStatus: {
					msg: 'Syncing',
					status: 'syncing',
				},
			});

			const {userId, userName} = getSettingsState();
			if (!userId) return failed('Unable to resolve userId');
			if (!userName) return failed('Unable to resolve userName');

			const persistDefaultsResult = hasPendingDefaultEvents()
				? persistPendingDefaultEvents()
				: succeeded('No pending default events', null);

			if (isFail(persistDefaultsResult)) {
				return failed(
					`Unable to persist default events. ${persistDefaultsResult.message}`,
				);
			}

			const persistFileName = getPersistFileName();
			if (isFail(persistFileName)) {
				return failed('Unable to resolve log file name');
			}
			logger.debug(
				'[sync-command] pending defaults',
				hasPendingDefaultEvents(),
			);

			const syncResult = await syncEpiqWithRemote({
				ownEventFileName: persistFileName.data,
			});

			if (isFail(syncResult)) {
				patchState({
					syncStatus: {
						msg: syncResult.message,
						status: 'outOfSync',
					},
				});

				return failed(`Unable to sync state. ${syncResult.message}`);
			}

			patchState({
				syncStatus: {
					msg: 'Synced',
					status: 'synced',
				},
				mode: Mode.DEFAULT,
			});

			const allLoadedEventsResult = loadMergedEvents();
			if (isFail(allLoadedEventsResult)) return failed('Unable to load events');

			materializeAll(allLoadedEventsResult.data);

			return succeeded('Synced', true);
		},
	},
	{
		intent: CmdIntent.Peek,
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const boardNodeResult = findInBreadCrumb(getState().breadCrumb, 'BOARD');
			if (isFail(boardNodeResult)) return boardNodeResult;

			const eventsResult = loadMergedEvents();
			if (isFail(eventsResult)) return failed(eventsResult.message);
			const allEvents = eventsResult.data;

			const {modifier} = getCmdState().commandMeta;
			let targetTime: number;

			if (modifier === 'now') {
				const resetResult = resetState();
				if (isFail(resetResult)) return resetResult;

				const materializeResult = materializeAll(allEvents);
				if (materializeResult.some(isFail)) {
					return failed(materializeResult.map(x => x.message).join(', '));
				}

				patchState({
					mode: Mode.DEFAULT,
					readOnly: false,
					timeMode: 'live',
					unappliedEvents: [],
				});

				return succeeded('Peeking now', true);
			}

			if (modifier === 'prev') {
				const previousEvent = getState().eventLog.at(-2);
				const previousTime = getEventTime(previousEvent);
				if (previousTime === null) return failed('No previous event to peek');
				targetTime = previousTime;
			} else if (modifier === 'next') {
				const nextEvent = getState().unappliedEvents.at(0);
				const nextTime = getEventTime(nextEvent);
				if (nextTime === null) return failed('No next event to peek');
				targetTime = nextTime;
			} else {
				const targetDate = parsePeekDateInput(modifier);
				if (!targetDate) {
					return failed('Invalid peek date');
				}

				targetTime = targetDate.getTime();
			}

			const boardId = boardNodeResult.data.id;
			const {appliedEvents, unappliedEvents} = splitEventsAtTime(
				allEvents,
				targetTime,
			);

			const resetResult = resetState();
			if (isFail(resetResult)) return resetResult;

			const materializeResult = materializeAll(appliedEvents);
			if (materializeResult.some(isFail)) {
				return failed(materializeResult.map(x => x.message).join(', '));
			}

			const boardNode = getState().nodes[boardId];
			if (!boardNode) {
				return failed('Board did not exist at peek date');
			}

			navigationUtils.navigate({
				currentNode: boardNode,
				selectedIndex: 0,
			});

			patchState({
				mode: Mode.DEFAULT,
				readOnly: true,
				timeMode: 'peek',
				unappliedEvents: unappliedEvents,
			});

			return succeeded(`Peeking `, true);
		},
	},
];
