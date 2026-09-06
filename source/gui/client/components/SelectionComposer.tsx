import React from 'react';
import {SelectedLineRange} from '@pierre/diffs/react';
import {GuiCommitDiffFile} from '../lib/gui-state.model';
import {CONTENT_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	encodeDiffCommentMarker,
	formatSelectionLabel,
} from '../../../lib/utils/diff-comment.js';
import {ActionRow, Textarea} from './FormPrimitives';
import {Button} from './Button';
import {extractSnippet, dedent} from '../lib/diff-selection';

// Rendered by MultiFileDiff right under the last selected line. One box for
// both outcomes: write the note first, then choose whether it becomes a
// comment on this ticket or a new ticket of its own.
export const SelectionComposer = ({
	sha,
	file,
	selection,
	note,
	onChangeNote,
	onAddComment,
	onFileTicket,
	onClear,
}: {
	sha: string;
	file: GuiCommitDiffFile;
	selection: SelectedLineRange;
	note: string;
	onChangeNote: (note: string) => void;
	onAddComment?: (body: string) => void;
	// Opens the title prompt; the row owns the actual filing.
	onFileTicket?: () => void;
	onClear: () => void;
}) => {
	const snippet = dedent(extractSnippet(file, selection));
	const selectionLabel = `${file.path} ${formatSelectionLabel(selection)}`;

	const comment = () => {
		const trimmedNote = note.trim();
		// Matches extractSnippet's own default: a range without a reported side
		// is expected to be a modern-git edge case at worst, not a real gap.
		const side = selection.side ?? 'additions';
		const endSide = selection.endSide ?? side;

		const marker = encodeDiffCommentMarker({
			filePath: file.path,
			start: selection.start,
			side,
			end: selection.end,
			endSide,
			note: trimmedNote,
			sha,
		});

		const body = [
			...(trimmedNote ? [trimmedNote, ''] : []),
			marker,
			`\`${file.path}\` ${formatSelectionLabel(selection)}`,
			'```',
			snippet,
			'```',
		].join('\n');

		onAddComment?.(body);
		onClear();
	};

	return (
		<div
			data-testid="selection-composer"
			style={{
				margin: '4px 0',
				padding: 10,
				border: `1px solid ${GUI_THEME.accent}`,
				borderRadius: 8,
				background: GUI_THEME.tertiary,
				boxShadow: `0 0 0 1px ${GUI_THEME.accent}33`,
			}}
		>
			<div style={{fontSize: TEXT.meta, color: GUI_THEME.secondary}}>
				{selectionLabel}
			</div>

			<Textarea
				autoFocus
				maxLength={Number.MAX_SAFE_INTEGER}
				value={note}
				placeholder="Add a note (optional)"
				onChange={event => onChangeNote(event.target.value)}
				onKeyDown={event => {
					if (event.key === 'Escape') onClear();
					if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
						if (onAddComment) comment();
					}
				}}
				style={{
					marginTop: 8,
					minHeight: 45,
					font: 'inherit',
					fontFamily: CONTENT_FONT,
					fontSize: TEXT.prose,
				}}
			/>

			<ActionRow>
				<Button variant="ghost" onClick={onClear}>
					Cancel
				</Button>
				{onFileTicket && (
					<Button variant="default" onClick={onFileTicket}>
						File ticket
					</Button>
				)}
				{onAddComment && (
					<Button variant="primary" onClick={comment}>
						Comment
					</Button>
				)}
			</ActionRow>
		</div>
	);
};
