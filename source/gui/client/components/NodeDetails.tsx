import {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {FormHeader} from './FormHeader';
import {Input} from './FormPrimitives';

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
	onRename,
	onClose,
}: {
	testId: string;
	kind: 'Board' | 'Swimlane' | 'Goal';
	title: string;
	// Given, the title is edited in place, as a ticket's is: Enter or leaving
	// it saves, Escape keeps the old one.
	onRename?: (title: string) => void;
	onClose: () => void;
}) => {
	const [draft, setDraft] = useState<string | null>(null);

	const save = () => {
		const next = draft?.trim();
		setDraft(null);
		if (next && next !== title) onRename?.(next);
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
				{draft !== null ? (
					<Input
						data-testid={`${testId}-title-input`}
						value={draft}
						autoFocus
						onChange={event => setDraft(event.target.value)}
						onKeyDown={event => {
							if (event.key === 'Enter') event.currentTarget.blur();
							if (event.key === 'Escape') setDraft(null);
						}}
						onBlur={save}
						style={{...TITLE_STYLE, flex: 1, padding: '2px 6px'}}
					/>
				) : (
					<span
						data-testid={`${testId}-title`}
						onClick={onRename ? () => setDraft(title) : undefined}
						style={{
							...TITLE_STYLE,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							cursor: onRename ? 'text' : 'default',
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
