import {exportBoardLayout} from '../../export/export.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {Filter} from '../model/app-state.model.js';
import {failed, isFail, succeeded} from '../model/result-types.js';
import {getCmdState} from '../state/cmd.state.js';
import {getState, patchState, updateState} from '../state/state.js';
import {patchUiState} from '../state/ux-state.js';
import {CmdKeywords} from './cmd-keywords.js';
import {CmdIntent} from './command-intent.js';
import {getCmdModifiers} from './command-modifiers.js';
import {editCommand} from './commands/edit.cmd.js';
import {initCommand} from './commands/init.cmd.js';
import {moveCommand} from './commands/move.cmd.js';
import {newCommand} from './commands/new.cmd.js';
import {openProjectCommand} from './commands/open.cmd.js';
import {peekCommand} from './commands/peek.cmd.js';
import {replayCommand} from './commands/replay.cmd.js';
import {yankCommand} from './commands/yank.cmd.js';
import {syncCommand} from './commands/sync.cmd.js';
import {deleteCommand} from './commands/delete.cmd.js';
import {closeIssueCommand} from './commands/close-issue.cmd.js';
import {reopenIssueCommand} from './commands/reopen-issue.cmd.js';
import {renameCommand} from './commands/rename.cmd.js';
import {untagTicketCommand} from './commands/untag-ticket.cmd.js';
import {tagTicketCommand} from './commands/tag-ticket.cmd.js';
import {assignUserCommand} from './commands/assign-user.cmd.js';
import {unassignUserCommand} from './commands/unassign-user.cmd.js';
import {commentCommand} from './commands/comment.cmd.js';
import {configCommand} from './commands/config.cmd.js';

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
		action: deleteCommand,
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
		action: closeIssueCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.ReopenIssue,
		description: 'Move a closed issue back to its previous swimlane',
		mode: Mode.COMMAND_LINE,
		action: reopenIssueCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Init,
		description: 'Initialize Epiq in the current git repository',
		mode: Mode.COMMAND_LINE,
		action: initCommand,
	},
	{
		intent: CmdIntent.OpenProject,
		description: 'Open a recently used epiq project, by number or path',
		mode: Mode.COMMAND_LINE,
		action: openProjectCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
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
		action: renameCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.UntagTicket,
		description: 'Remove a tag from the selected issue',
		mode: Mode.COMMAND_LINE,
		action: untagTicketCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.TagTicket,
		description: 'Add or create a tag on the selected issue',
		mode: Mode.COMMAND_LINE,
		action: tagTicketCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.AssignUserToTicket,
		description: 'Assign a user to the selected issue',
		mode: Mode.COMMAND_LINE,
		action: assignUserCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.UnassignUserFromTicket,
		description: 'Remove an assignee from the selected issue',
		mode: Mode.COMMAND_LINE,
		action: unassignUserCommand,
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Comment,
		description: 'Add a comment to the selected issue',
		mode: Mode.COMMAND_LINE,
		action: async (_, cmdState) => commentCommand(cmdState),
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
		action: (_, cmdState) => configCommand(cmdState),
	},
];
