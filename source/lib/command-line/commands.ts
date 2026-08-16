import {ulid} from 'ulid';
import {exportBoardLayout} from '../../export/export.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {setConfig} from '../config/user-config.js';
import {materializeAndPersistAll} from '../event/event-materialize-and-persist.js';
import {resolveActorId} from '../event/event-persist.js';
import {resolveReopenParentFromLog} from '../event/log-utils.js';
import {CLOSED_SWIMLANE_ID} from '../event/static-ids.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {
	BreadCrumb,
	Filter,
	findInBreadCrumb,
} from '../model/app-state.model.js';
import {isTicketNode} from '../model/context.model.js';
import {failed, isFail, succeeded} from '../model/result-types.js';
import {findAncestor} from '../repository/node-repo.js';
import {resolveAndPersistRankForMove} from '../repository/rank.js';
import {getCmdArg, getCmdState, replaceCmdInput} from '../state/cmd.state.js';
import {getSettingsState, patchSettingsState} from '../state/settings.state.js';
import {
	getRenderedChildren,
	getState,
	patchState,
	updateState,
} from '../state/state.js';
import {patchUiState} from '../state/ux-state.js';
import {getPersistRoot} from '../storage/paths.js';
import {preferBestName} from '../utils/contributor.utils.js';
import {openUrl} from '../utils/open-in-browser.js';
import {CmdKeywords} from './cmd-keywords.js';
import {CmdIntent} from './command-intent.js';
import {ConfigModifiers, getCmdModifiers} from './command-modifiers.js';
import {MAX_COMMENT_LENGTH} from '../utils/comment.limits.js';
import {editCommand} from './commands/edit.cmd.js';
import {initCommand} from './commands/init.cmd.js';
import {moveCommand} from './commands/move.cmd.js';
import {newCommand} from './commands/new.cmd.js';
import {peekCommand} from './commands/peek.cmd.js';
import {replayCommand} from './commands/replay.cmd.js';
import {setAutoSyncDurationCommand} from './commands/set-auto-sync-duration.cmd.js';
import {setAttachmentMaxKbCommand} from './commands/set-attachment-max-kb.cmd.js';
import {setAutoSyncCommand} from './commands/set-auto-sync.cmd.js';
import {setLogLevelCommand} from './commands/set-log-level.cmd.js';
import {yankCommand} from './commands/yank.cmd.js';
import {syncCommand} from './commands/sync.cmd.js';
import {AppEvent} from '../event/event.model.js';

const isAddIssueCommentEvent = (
	event: AppEvent,
): event is AppEvent & {
	action: 'add.issue.comment';
	payload: {
		id: string;
		issue: string;
		author: string;
		md: string;
	};
} => event.action === 'add.issue.comment';

const findTagByName = (name: string) =>
	Object.values(getState().tags).find(tag => tag.name === name);

// The registry only holds people explicitly created or assigned, so it is often
// empty even of you; log authors are candidates too.
const getAssignableContributors = (): {
	id: string;
	name: string;
	isExternal: boolean;
}[] => {
	// May run before boot has populated the log.
	const {eventLog = [], contributors} = getState();
	const byId = new Map<string, string>();
	const authorIds = new Set<string>();

	for (const event of eventLog) {
		if (!event.userId) continue;

		byId.set(event.userId, event.userName ?? '');
		authorIds.add(event.userId);
	}

	for (const contributor of Object.values(contributors)) {
		// Removal must beat the log's name, or a removed name reappears here.
		if (contributor.tombstoned) {
			byId.set(contributor.id, contributor.name);
			continue;
		}

		// Offer the name the user can actually type — the log's copy is sanitized.
		byId.set(
			contributor.id,
			preferBestName(contributor.name, byId.get(contributor.id)) ??
				contributor.name,
		);
	}

	return [...byId.entries()].map(([id, name]) => ({
		id,
		name,
		isExternal: !authorIds.has(id),
	}));
};

const getPersistRootValue = async () => {
	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	return succeeded('Resolved persist root', persistRootResult.value);
};

export const commands: CommandLineActionEntry[] = [
	{
		systemOnly: true,
		intent: CmdIntent.Move,
		description: 'Internal move-state command',
		mode: Mode.COMMAND_LINE,
		action: moveCommand,
	},
	{
		intent: CmdIntent.Delete,
		description: 'Delete the currently selected node',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {contextNode, selectedIndex} = getState();
			const child = getRenderedChildren(contextNode.id)[selectedIndex];
			if (!child) return failed('Unable to resolve child to delete');

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;

			if (child.context === 'COMMENT') {
				const commentId = child.id;

				const issueId = isTicketNode(contextNode)
					? contextNode.id
					: contextNode.parentNodeId;

				if (!issueId) return failed('Unable to resolve comment issue');

				const ticket = getState().nodes[issueId];

				if (!ticket || !isTicketNode(ticket)) {
					return failed('Unable to resolve comment issue');
				}

				const commentEvent = ticket.log
					?.filter(isAddIssueCommentEvent)
					.find(event => event.payload.id === commentId);

				if (!commentEvent) return failed('Unable to resolve comment');

				if (commentEvent.payload.author !== userRes.value.userId) {
					return failed('You can only delete your own comments');
				}

				return materializeAndPersistAll(
					[
						{
							id: ulid(),
							action: 'delete.issue.comment',
							payload: {
								id: commentId,
								issue: issueId,
							},
							...userRes.value,
						},
					],
					persistRootResult.value,
				);
			}

			return materializeAndPersistAll(
				[
					{
						id: ulid(),
						action: 'delete.node',
						payload: {
							id: child.id,
						},
						...userRes.value,
					},
				],
				persistRootResult.value,
			);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Filter,
		description: 'Filter the board, for example `:filter tag urgent`',
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {modifier, inputString} = getCmdState().commandMeta;
			const regex = /(!=|=)/;
			const [filterTarget] = modifier.split(regex);
			const isValidModifier = (val: string): val is Filter['target'] =>
				getCmdModifiers(CmdKeywords.FILTER)
					.map(x => x.split(regex)[0])
					.includes(val);

			if (!filterTarget || !isValidModifier(filterTarget)) {
				return failed('Invalid filter modifier');
			}

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

			return succeeded('Filter updated', null);
		},
	},
	{
		intent: CmdIntent.ViewHelp,
		description: 'Open the help screen',
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {contextNode, selectedIndex, selectedNode, breadCrumb} = getState();
			patchUiState({
				pendingNavTarget: {
					contextNode,
					breadCrumb,
					selectedIndex,
					selectedNode,
				},
			});
			patchState({mode: Mode.HELP});
			return succeeded('Viewing help', null);
		},
	},
	{
		intent: CmdIntent.CloseIssue,
		description: 'Move the selected issue to the closed swimlane',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {contextNode, selectedIndex} = getState();
			const target = getRenderedChildren(contextNode.id)[selectedIndex];

			if (!target) return failed('Unable to close issue, no target found');
			if (!isTicketNode(target)) return failed('Cannot close in this context');

			const closeSwimlane = getState().nodes[CLOSED_SWIMLANE_ID];
			if (!closeSwimlane) return failed('Unable to locate closed swimlane');

			if (target.parentNodeId === closeSwimlane.id) {
				return failed('Issue is already closed');
			}

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;
			const persistRoot = persistRootResult.value;

			const rankResult = resolveAndPersistRankForMove(
				closeSwimlane.id,
				target.id,
				{at: 'end'},
				userRes.value,
				persistRoot,
			);
			if (isFail(rankResult)) return rankResult;

			const result = materializeAndPersistAll(
				[
					{
						id: ulid(),
						action: 'close.issue',
						payload: {
							id: target.id,
							parent: closeSwimlane.id,
							rank: rankResult.value,
						},
						...userRes.value,
					},
				],
				persistRoot,
			);

			if (isFail(result)) return result;

			return succeeded('Issue closed', null);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.ReopenIssue,
		description: 'Move a closed issue back to its previous swimlane',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {contextNode, selectedIndex} = getState();
			const target = getRenderedChildren(contextNode.id)[selectedIndex];

			if (!target) return failed('Unable to reopen issue, no target found');

			const ticketResult =
				target.context === 'TICKET'
					? succeeded('Resolved ticket', target)
					: findAncestor(target.id, 'TICKET');

			if (isFail(ticketResult)) {
				return failed('Cannot reopen in this context');
			}

			const ticket = ticketResult.value;

			const closeSwimlane = getState().nodes[CLOSED_SWIMLANE_ID];
			if (!closeSwimlane) return failed('Unable to locate closed swimlane');

			if (ticket.parentNodeId !== closeSwimlane.id) {
				return failed('Issue is not closed');
			}

			if (!isTicketNode(ticket)) return failed('Target node is not issue');

			const previousParentId = resolveReopenParentFromLog(ticket);
			if (!previousParentId) {
				return failed('Unable to resolve previous parent from issue history');
			}

			if (previousParentId === closeSwimlane.id) {
				return failed('Previous parent resolves to closed swimlane');
			}

			const previousParent = getState().nodes[previousParentId];
			if (!previousParent) return failed('Previous parent no longer exists');

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;
			const persistRoot = persistRootResult.value;

			const rankResult = resolveAndPersistRankForMove(
				previousParent.id,
				ticket.id,
				{at: 'end'},
				userRes.value,
				persistRoot,
			);
			if (isFail(rankResult)) return rankResult;

			const result = materializeAndPersistAll(
				[
					{
						id: ulid(),
						action: 'reopen.issue',
						payload: {
							id: ticket.id,
							parent: previousParent.id,
							rank: rankResult.value,
						},
						...userRes.value,
					},
				],
				persistRoot,
			);

			if (isFail(result)) return result;

			return succeeded('Issue reopened', null);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Init,
		description: 'Initialize Epiq in the current git repository',
		mode: Mode.COMMAND_LINE,
		action: initCommand,
	},
	{
		intent: CmdIntent.NewItem,
		description: 'Create a new board, swimlane, or issue',
		mode: Mode.COMMAND_LINE,
		action: newCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Rename,
		description: 'Rename the currently selected node',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {contextNode, selectedIndex} = getState();
			const node = getRenderedChildren(contextNode.id)[selectedIndex];
			if (!node) return failed('Missing node');
			if (node.readonly) return failed('Cannot rename readonly node');

			const newName = getCmdArg();
			if (!newName) return failed('Provide a title');

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;

			return materializeAndPersistAll(
				[
					{
						id: ulid(),
						action: 'edit.title',
						payload: {id: node.id, name: newName},
						...userRes.value,
					},
				],
				persistRootResult.value,
			);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.UntagTicket,
		description: 'Remove a tag from the selected issue',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
			if (!name) return failed('Provide a tag');

			const existingTag = findTagByName(name);
			if (!existingTag) return failed(`Tag "${name}" does not exist`);

			const {selectedNode} = getState();
			if (!selectedNode) return failed('Invalid untag target');

			const ticketResult = findAncestor(selectedNode.id, 'TICKET');
			if (isFail(ticketResult)) {
				return failed('Unable to untag issue in this context');
			}

			const ticket = ticketResult.value;
			if (!isTicketNode(ticket)) return failed('Target node is not issue');

			const tags = ticket.props.tags ?? [];

			if (!tags.includes(existingTag.id)) {
				return failed('Issue is not tagged with that tag');
			}

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;

			return materializeAndPersistAll(
				[
					{
						id: ulid(),
						action: 'remove.issue.tag',
						payload: {
							id: ticket.id,
							tag: existingTag.id,
						},
						...userRes.value,
					},
				],
				persistRootResult.value,
			);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.TagTicket,
		description: 'Add or create a tag on the selected issue',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
			if (!name) return failed('Provide a tag');

			const {selectedNode} = getState();
			if (!selectedNode) return failed('Invalid tag target');

			const ticketResult = findAncestor(selectedNode.id, 'TICKET');
			if (isFail(ticketResult)) {
				return failed('Unable to tag issue in this context');
			}

			const ticket = ticketResult.value;
			if (!isTicketNode(ticket)) return failed('Target node is not issue');

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;

			const existingTag = findTagByName(name);
			const tagId = existingTag?.id ?? ulid();

			const tags = ticket.props.tags ?? [];

			if (tags.includes(tagId)) {
				return failed('Already tagged with that tag');
			}

			return materializeAndPersistAll(
				[
					...(existingTag
						? []
						: [
								{
									id: ulid(),
									action: 'create.tag' as const,
									payload: {
										id: tagId,
										name,
									},
									...userRes.value,
								},
						  ]),
					{
						id: ulid(),
						action: 'add.issue.tag',
						payload: {
							id: ticket.id,
							tag: tagId,
						},
						...userRes.value,
					},
				],
				persistRootResult.value,
			);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.AssignUserToTicket,
		description: 'Assign a user to the selected issue',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {modifier, inputString} = getCmdState().commandMeta;
			const raw = (modifier || inputString).trim();
			if (!raw) return failed('Provide an assignee');

			// "!" is the explicit gesture for inventing somebody new; without it an
			// unmatched name is refused rather than created from a typo.
			const wantsExternal = raw.startsWith('!');
			const name = (wantsExternal ? raw.slice(1) : raw).trim();
			if (!name) return failed('Provide an assignee');

			const {selectedIndex, contextNode} = getState();
			const selected = getRenderedChildren(contextNode.id)[selectedIndex];
			if (!selected) return failed('Invalid assign target');

			const ticketResult = findAncestor(selected.id, 'TICKET');
			if (isFail(ticketResult)) {
				return failed('Unable to assign issue in this context');
			}

			const ticket = ticketResult.value;
			if (!isTicketNode(ticket)) return failed('Target node is not issue');

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;

			const candidates = getAssignableContributors();
			const isSelf = !wantsExternal && name.toLowerCase() === 'me';

			let contributorId: string;
			let contributorName: string;

			if (isSelf) {
				// The id your events are authored under, so both refer to one person.
				contributorId = userRes.value.userId;
				contributorName =
					candidates.find(c => c.id === contributorId)?.name ??
					userRes.value.userName;
			} else {
				const matches = candidates.filter(c => c.name === name);

				if (matches.length > 1) {
					return failed(
						`"${name}" matches ${matches.length} contributors (${matches
							.map(c => c.id)
							.join(', ')}). Assign from the GUI to choose by id.`,
					);
				}

				const match = matches[0];

				if (!match && !wantsExternal) {
					return failed(
						`No contributor named "${name}". Use "!${name}" to add them as an external assignee.`,
					);
				}

				contributorId = match?.id ?? ulid();
				contributorName = match?.name ?? name;
			}

			const assignees = ticket.props.assignees ?? [];

			if (assignees.includes(contributorId)) {
				return failed('Assignee already assigned');
			}

			const isRegistered = Boolean(getState().contributors[contributorId]);

			return materializeAndPersistAll(
				[
					...(isRegistered
						? []
						: [
								{
									id: ulid(),
									action: 'create.contributor' as const,
									payload: {
										id: contributorId,
										name: contributorName,
									},
									...userRes.value,
								},
						  ]),
					{
						id: ulid(),
						action: 'add.issue.assignee',
						payload: {
							id: ticket.id,
							assignee: contributorId,
						},
						...userRes.value,
					},
				],
				persistRootResult.value,
			);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.UnassignUserFromTicket,
		description: 'Remove an assignee from the selected issue',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
			if (!name) return failed('Provide an assignee to remove');

			const {selectedNode} = getState();
			if (!selectedNode) return failed('Invalid unassign target');

			const ticketResult = findAncestor(selectedNode.id, 'TICKET');
			if (isFail(ticketResult)) {
				return failed('Unable to unassign in this context');
			}

			const ticket = ticketResult.value;
			if (!isTicketNode(ticket)) return failed('Target node is not issue');

			const assignees = ticket.props.assignees ?? [];

			const isSelf = name.toLowerCase() === 'me';

			// Resolved against this issue's assignees, not the whole registry, so a
			// shared name is only ambiguous when both people are assigned here.
			const matches = isSelf
				? assignees.filter(id => id === userRes.value.userId)
				: getAssignableContributors()
						.filter(c => c.name === name && assignees.includes(c.id))
						.map(c => c.id);

			if (matches.length > 1) {
				return failed(
					`"${name}" matches ${matches.length} assignees (${matches.join(
						', ',
					)}). Unassign from the GUI to choose by id.`,
				);
			}

			const contributorId = matches[0];

			if (!contributorId) {
				return failed(
					isSelf
						? 'Issue is not assigned to you'
						: `Issue is not assigned to "${name}"`,
				);
			}

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;

			return materializeAndPersistAll(
				[
					{
						id: ulid(),
						action: 'remove.issue.assignee',
						payload: {
							id: ticket.id,
							assignee: contributorId,
						},
						...userRes.value,
					},
				],
				persistRootResult.value,
			);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Comment,
		description: 'Add a comment to the selected issue',
		mode: Mode.COMMAND_LINE,
		action: async (_, cmdState) => {
			const md = cmdState.inputString.trim();
			if (!md) return failed('Provide a comment');

			if (md.length > MAX_COMMENT_LENGTH)
				return failed(`Cannot exceed ${MAX_COMMENT_LENGTH} characters`);

			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {breadCrumb, selectedNode} = getState();
			const issueResult = findInBreadCrumb(
				[...breadCrumb, selectedNode] as BreadCrumb,
				'TICKET',
			);
			if (isFail(issueResult)) return failed('Edit target must be an issue');

			const target = issueResult.value;
			if (!target) return failed('Invalid comment target');

			const ticketResult =
				target.context === 'TICKET'
					? succeeded('Resolved ticket', target)
					: findAncestor(target.id, 'TICKET');

			if (isFail(ticketResult)) {
				return failed('Unable to comment on issue in this context');
			}

			const ticket = ticketResult.value;
			if (!isTicketNode(ticket)) return failed('Target node is not issue');

			const persistRootResult = await getPersistRootValue();
			if (isFail(persistRootResult)) return persistRootResult;

			return materializeAndPersistAll(
				[
					{
						id: ulid(),
						action: 'add.issue.comment',
						payload: {
							id: ulid(),
							issue: ticket.id,
							author: userRes.value.userId,
							md,
						},
						...userRes.value,
					},
				],
				persistRootResult.value,
			);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Sync,
		description: 'Pull, commit, and push Epiq state',
		mode: Mode.COMMAND_LINE,
		action: syncCommand,
	},
	{
		intent: CmdIntent.Peek,
		description: 'View board state at another point in time',
		mode: Mode.COMMAND_LINE,
		action: peekCommand,
	},
	{
		intent: CmdIntent.Replay,
		description: 'Replay board history forward from a point in time',
		mode: Mode.COMMAND_LINE,
		action: replayCommand,
	},
	{
		intent: CmdIntent.Export,
		description: 'Export the current board layout to markdown',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const exportResult = await exportBoardLayout();
			if (isFail(exportResult)) return exportResult;

			patchState({
				mode: Mode.DEFAULT,
			});

			return succeeded('Export successful', true);
		},
	},
	{
		intent: CmdIntent.Exit,
		description: 'Exit the application',
		mode: Mode.COMMAND_LINE,
		action: async () => {
			navigationUtils.exit();
			return succeeded('Exit successful', true);
		},
	},
	{
		intent: CmdIntent.Edit,
		description: 'Edit title or description',
		mode: Mode.COMMAND_LINE,
		action: async (_, cmdState) => editCommand(cmdState),
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Yank,
		description:
			'Yank (copy) ref, title, description, tags, or assignees to the clipboard',
		mode: Mode.COMMAND_LINE,
		action: async (_, cmdState) => yankCommand(cmdState),
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Config,
		description: 'Update editor, username, view, autosync, or sync debounce',
		mode: Mode.COMMAND_LINE,
		action: (_, cmdState) => {
			const value = cmdState.inputString.trim();

			switch (cmdState.modifier) {
				case ConfigModifiers.USERNAME: {
					const {userId, preferredEditor, userName} = getSettingsState();

					const resolvedUserName = value || userName;
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

					return succeeded(`Username set to "${resolvedUserName}"`, null);
				}

				case ConfigModifiers.EDITOR: {
					if (!value) return failed('No editor provided');

					const persistResult = setConfig({preferredEditor: value});
					if (isFail(persistResult)) return persistResult;

					patchSettingsState({preferredEditor: value});
					patchState({mode: Mode.DEFAULT});

					return succeeded(`Editor configuration set to "${value}"`, null);
				}

				case ConfigModifiers.VIEW: {
					if (value !== 'wide' && value !== 'dense') {
						return failed('Invalid view mode');
					}

					const persistResult = setConfig({viewMode: value});
					if (isFail(persistResult)) return persistResult;

					patchSettingsState({viewMode: value});
					patchState({mode: Mode.DEFAULT});

					return succeeded(`View set to "${value}"`, null);
				}

				case ConfigModifiers.AUTOSYNC:
					return setAutoSyncCommand();

				case ConfigModifiers.LOG_LEVEL:
					return setLogLevelCommand();

				case ConfigModifiers.SYNC_DEBOUNCE_MS:
					return setAutoSyncDurationCommand();

				case ConfigModifiers.ATTACHMENT_MAX_KB:
					return setAttachmentMaxKbCommand();

				default:
					return failed('Unknown config command');
			}
		},
	},
	{
		intent: CmdIntent.Coffee,
		description: 'Sponsor the development of Epiq!',
		mode: Mode.COMMAND_LINE,
		action: () => {
			const modifier = getCmdState().commandMeta.modifier;
			if (modifier === 'custom') {
				openUrl(
					'https://github.com/sponsors/ljtn?frequency=one-time&sponsor=ljtn',
				);
			} else {
				openUrl(
					`https://github.com/sponsors/ljtn/sponsorships?sponsor=ljtn&preview=true&frequency=one-time&amount=${modifier}`,
				);
			}
			replaceCmdInput('');
			return succeeded('Thanks you!', null);
		},
	},
];
