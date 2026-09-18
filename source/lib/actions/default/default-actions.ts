import {CmdKeywords} from '../../command-line/cmd-keywords.js';
import {
	getCmdModifiers,
	YankModifiers,
} from '../../command-line/command-modifiers.js';
import {openCommitDiffInEditor} from '../../commits/commits.js';
import {selectionFromRows} from '../../commits/patch-parse.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {failed, succeeded} from '../../model/result-types.js';
import {
	diffMarkFor,
	getOpenPatch,
	openPagerSha,
	setDiffMark,
	setPendingDiffComment,
} from '../../state/diff-pager.state.js';
import {FieldNames} from '../../repository/fielNames.js';
import {nodeRepo} from '../../repository/node-repo.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {replaceCmdInput} from '../../state/cmd.state.js';
import {getState, patchState} from '../../state/state.js';
import {openAttachment} from '../../utils/attachment.utils.js';
import {Intent} from '../../utils/key-intent.js';
import {HelpActions} from '../help/help-actions.js';
import {IdentityActions} from '../identity/identity-actions.js';
import {PaletteActions} from '../palette/palette-actions.js';
import {navigationUtils} from './navigation-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	// First, so it leads the shortcut bar: it is the way to every command.
	{
		intent: Intent.InitCommandLine,
		mode: Mode.DEFAULT,
		description: '[:] write command',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput('');
			return succeeded('Entering command line mode', null);
		},
	},
	...HelpActions,
	...IdentityActions,
	...PaletteActions,
	{
		intent: Intent.AddItem,
		mode: Mode.DEFAULT,
		description: '[n] new...',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`${CmdKeywords.NEW} `);
			return succeeded('Adding new item', null);
		},
	},
	{
		intent: Intent.Delete,
		mode: Mode.DEFAULT,
		description: '[d] delete',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`${CmdKeywords.DELETE} `);
			return succeeded('Deleting item', null);
		},
	},

	{
		intent: Intent.Confirm,
		mode: Mode.DEFAULT,
		description: '[<Enter>] confirm/enter',
		action: () => {
			const {selectedNode, contextNode} = getState();
			const children = getOrderedChildren(selectedNode?.id ?? '');

			if (!children?.length) {
				// Attachment nodes carry the attachment id: enter opens the image.
				const attachment = selectedNode
					? nodeRepo.getAttachment(selectedNode.id)
					: undefined;
				if (attachment) {
					return openAttachment(attachment);
				}

				if (selectedNode?.title === FieldNames.DESCRIPTION) {
					patchState({mode: Mode.COMMAND_LINE});
					replaceCmdInput(`${CmdKeywords.EDIT} description `);
					return succeeded('Propose command', true);
				}

				if (selectedNode?.title === FieldNames.ASSIGNEES) {
					patchState({mode: Mode.COMMAND_LINE});
					replaceCmdInput(`${CmdKeywords.ASSIGN} `);
					return succeeded('Propose command', true);
				}

				if (selectedNode?.title === FieldNames.TAGS) {
					patchState({mode: Mode.COMMAND_LINE});
					replaceCmdInput(`${CmdKeywords.TAG} `);
					return succeeded('Propose command', true);
				}

				if (
					contextNode.title === FieldNames.DESCRIPTION &&
					selectedNode?.context === 'TEXT'
				) {
					patchState({mode: Mode.COMMAND_LINE});
					replaceCmdInput(`${CmdKeywords.EDIT} description `);
					return succeeded('Propose command', true);
				}
			}

			navigationUtils.enterChildNode();
			return succeeded('Entering context', null);
		},
	},

	{
		intent: Intent.OpenInEditor,
		mode: Mode.DEFAULT,
		description: '[o] open in editor',
		action: () => {
			const {selectedNode, contextNode} = getState();

			// A commit node carries its sha as its id, and sits under the Diff
			// field. `o` works both from the commit list, where the commit is the
			// selection, and from inside its patch, where it is the context.
			const sha =
				contextNode.title === FieldNames.DIFF
					? selectedNode?.id
					: openPagerSha() ?? undefined;

			if (!sha) return succeeded('Nothing here opens in an editor', null);

			return openCommitDiffInEditor({sha});
		},
	},

	{
		intent: Intent.MarkDiffLine,
		mode: Mode.DEFAULT,
		description: '[s] mark line',
		action: () => {
			const sha = openPagerSha();
			if (!sha) return succeeded('Nothing to mark here', null);

			const {selectedIndex} = getState();

			// Pressing it again on the marked row clears it, so there is a way out
			// of a range without leaving the patch.
			const existing = diffMarkFor(sha);
			setDiffMark(
				existing === selectedIndex
					? null
					: {sha, row: Math.max(0, selectedIndex)},
			);

			return succeeded('Marked diff line', null);
		},
	},

	{
		intent: Intent.CommentOnDiffLine,
		mode: Mode.DEFAULT,
		description: '[c] comment on line',
		action: () => {
			const sha = openPagerSha();
			if (!sha) return succeeded('Nothing to comment on here', null);

			const patch = getOpenPatch();
			if (!patch || patch.sha !== sha) {
				return failed('The diff is still loading');
			}

			const {selectedIndex} = getState();
			const cursor = Math.max(0, selectedIndex);

			// No mark means the line under the cursor, which is the common case.
			const from = diffMarkFor(sha) ?? cursor;

			const selection = selectionFromRows(patch.rows, from, cursor);
			if (!selection.ok) return failed(selection.reason);

			// Held for the note the command line is about to collect.
			setPendingDiffComment({sha, selection: selection.value});

			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`${CmdKeywords.COMMENT} `);

			return succeeded('Commenting on a diff line', null);
		},
	},

	{
		intent: Intent.Yank,
		mode: Mode.DEFAULT,
		description: '[y] yank',
		action: () => {
			const {selectedNode} = getState();

			// Yank the field under the cursor when one is selected; otherwise
			// default to the ref. Fall back to ref when the preferred target has
			// nothing to yank (e.g. the tags field of an untagged issue).
			const preferred =
				selectedNode?.title === FieldNames.DESCRIPTION
					? YankModifiers.DESCRIPTION
					: selectedNode?.title === FieldNames.TAGS
					? YankModifiers.TAGS
					: selectedNode?.title === FieldNames.ASSIGNEES
					? YankModifiers.ASSIGNEES
					: YankModifiers.REF;

			const available = getCmdModifiers(CmdKeywords.YANK);
			const modifier = available.includes(preferred)
				? preferred
				: YankModifiers.REF;

			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`${CmdKeywords.YANK} ${modifier}`);
			return succeeded('Propose command', true);
		},
	},
	{
		intent: Intent.EditTitle,
		mode: Mode.DEFAULT,
		description: '[r] rename title',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(
				`${CmdKeywords.EDIT} title ${getState().selectedNode?.title}`,
			);
			return succeeded('Exiting context', null);
		},
	},
	{
		intent: Intent.EditDescription,
		mode: Mode.DEFAULT,
		description: '[e] edit desc',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`${CmdKeywords.EDIT} description `);
			return succeeded('Exiting context', null);
		},
	},
	{
		intent: Intent.Exit,
		mode: Mode.DEFAULT,
		description: '[q] exit context',
		action: () => {
			navigationUtils.enterParentNode();
			return succeeded('Exiting context', null);
		},
	},

	{
		intent: Intent.NavPreviousItem,
		mode: Mode.DEFAULT,
		description: '[arrows/hjkl] navigate',
		action: () => {
			navigationUtils.navigateToPreviousItem();
			return succeeded('Navigating to previous item', null);
		},
	},
	{
		intent: Intent.NavNextItem,
		mode: Mode.DEFAULT,
		action: () => {
			navigationUtils.navigateToNextItem();
			return succeeded('Navigating to next item', null);
		},
	},
	{
		intent: Intent.NavToPreviousContainer,
		mode: Mode.DEFAULT,
		action: () => {
			navigationUtils.navigateToPreviousContainer();
			return succeeded('Navigating to previous container', null);
		},
	},
	{
		intent: Intent.NavToNextContainer,
		mode: Mode.DEFAULT,
		action: () => {
			navigationUtils.navigateToNextContainer();
			return succeeded('Navigating to next container', null);
		},
	},
];
