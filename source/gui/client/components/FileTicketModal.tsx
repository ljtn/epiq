import {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {Textarea} from './FormPrimitives';

// Same overlay/panel language as CreateNodeModal, but with the extra fields
// (note, read-only snippet) that a bare title-only modal doesn't have room for.
export const FileTicketModal = ({
	defaultTitle,
	snippetLabel,
	snippet,
	onCreate,
	onClose,
}: {
	defaultTitle: string;
	snippetLabel: string;
	snippet: string;
	onCreate: (params: {title: string; note: string}) => void;
	onClose: () => void;
}) => {
	const [title, setTitle] = useState(defaultTitle);
	const [note, setNote] = useState('');

	const submit = () => {
		const trimmedTitle = title.trim();
		if (!trimmedTitle) return;

		onCreate({title: trimmedTitle, note: note.trim()});
	};

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: 'rgba(0, 0, 0, 0.25)',
				backdropFilter: 'blur(.5px)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 1000,
			}}
			onMouseDown={onClose}
		>
			<form
				onSubmit={event => {
					event.preventDefault();
					submit();
				}}
				onMouseDown={event => event.stopPropagation()}
				style={{
					marginTop: '-120px',
					width: 460,
					maxHeight: '70vh',
					display: 'flex',
					flexDirection: 'column',
					background: GUI_THEME.panel,
					border: `1px solid ${GUI_THEME.line}`,
					borderRadius: 12,
					padding: 20,
				}}
			>
				<div
					style={{
						color: GUI_THEME.accent,
						fontSize: 10,
						marginBottom: 8,
						letterSpacing: 1,
						textTransform: 'uppercase',
					}}
				>
					File a ticket
				</div>

				<input
					autoFocus
					value={title}
					placeholder="Ticket title"
					onChange={event => setTitle(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Escape') onClose();
					}}
					style={{
						width: '100%',
						boxSizing: 'border-box',
						background: GUI_THEME.bg,
						color: GUI_THEME.primary,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 8,
						padding: '10px',
						font: 'inherit',
						fontSize: 12,
						outline: 'none',
						boxShadow: `inset 0 0 0 1px ${GUI_THEME.accent}22`,
					}}
				/>

				<Textarea
					maxLength={Number.MAX_SAFE_INTEGER}
					value={note}
					placeholder="Add a note (optional)"
					onChange={event => setNote(event.target.value)}
					style={{
						marginTop: 10,
						minHeight: 45,
						font: 'inherit',
						fontSize: 12,
					}}
				/>

				<div
					style={{
						marginTop: 10,
						color: GUI_THEME.secondary,
						fontSize: 11,
					}}
				>
					{snippetLabel}
				</div>
				<pre
					style={{
						margin: '4px 0 0',
						padding: '10px 12px',
						background: GUI_THEME.bg,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 8,
						overflow: 'auto',
						fontFamily:
							'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
						fontSize: 12,
						color: GUI_THEME.primary,
					}}
				>
					{snippet}
				</pre>

				<div
					style={{
						display: 'flex',
						justifyContent: 'flex-end',
						gap: 10,
						marginTop: 16,
					}}
				>
					<Button type="button" variant="ghost" onClick={onClose}>
						cancel
					</Button>

					<Button type="submit" variant="primary" disabled={!title.trim()}>
						file ticket
					</Button>
				</div>
			</form>
		</div>
	);
};
