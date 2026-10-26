import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {FormHeader} from './FormHeader';
import {Input} from './FormPrimitives';
import {useEditDraft} from '../lib/ticket-drafts';

// A board's or a lane's panel: its description, and what can be said about
// it. Kin to a ticket's panel, and named for what it belongs to so it is not
// read as one.

const TITLE_STYLE = {
	fontSize: 13,
	fontWeight: 600,
	color: GUI_THEME.primary,
	minWidth: 0,
} as const;

export const DetailsHeader = ({
	testId,
	kind,
	title,
	rename,
	onClose,
}: {
	testId: string;
	kind: 'Board' | 'Swimlane' | 'Goal';
	title: string;
	// Given, the title is edited in place, as a ticket's is, in a draft kept
	// under the node's id: Enter or leaving it saves, Escape keeps the old one.
	rename?: {nodeId: string; onSave: (title: string) => void};
	onClose: () => void;
}) => {
	const edit = useEditDraft(rename?.nodeId ?? '', 'title', title);
	const save = () => {
		const next = edit.text.trim();
		const changed = edit.changed;
		edit.stop();
		if (changed && next && next !== title) rename?.onSave(next);
	};

	return (
		<FormHeader testId={testId}>
			<div
				style={{
					display: 'flex',
					alignItems: 'baseline',
					gap: 8,
					minWidth: 0,
					flex: 1,
				}}
			>
				<span
					style={{
						color: GUI_THEME.accent,
						fontSize: 10,
						letterSpacing: 1,
						textTransform: 'uppercase',
						flexShrink: 0,
					}}
				>
					{kind}
				</span>
				{rename && edit.editing ? (
					<Input
						data-testid={`${testId}-title-input`}
						value={edit.text}
						autoFocus
						onChange={event => edit.setText(event.target.value)}
						onKeyDown={event => {
							if (event.key === 'Enter') event.currentTarget.blur();
							if (event.key === 'Escape') edit.stop();
						}}
						onBlur={save}
						style={{...TITLE_STYLE, flex: 1, padding: '2px 6px'}}
					/>
				) : rename ? (
					// A button, as Manage goals' names are, so a keyboard reaches it.
					<button
						type="button"
						data-testid={`${testId}-title`}
						onClick={edit.start}
						style={{
							...TITLE_STYLE,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							padding: 0,
							border: 'none',
							background: 'transparent',
							fontFamily: 'inherit',
							textAlign: 'left',
							cursor: 'text',
						}}
					>
						{title}
					</button>
				) : (
					<span
						data-testid={`${testId}-title`}
						style={{
							...TITLE_STYLE,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{title}
					</span>
				)}
			</div>

			<Button variant="ghost" onClick={onClose} title="Close">
				×
			</Button>
		</FormHeader>
	);
};
