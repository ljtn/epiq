import {Button} from './Button';
import {GUI_THEME} from '../lib/gui-theme';

type Props = {
	eyebrow: string;
	heading: string;
	body: string;
	confirmLabel: string;
	onConfirm: () => void;
	onClose: () => void;
};

export const ConfirmModal = ({
	eyebrow,
	heading,
	body,
	confirmLabel,
	onConfirm,
	onClose,
}: Props) => (
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
			data-testid="confirm-modal"
			onSubmit={event => {
				event.preventDefault();
				onConfirm();
			}}
			onMouseDown={event => event.stopPropagation()}
			onKeyDown={event => {
				if (event.key === 'Escape') onClose();
			}}
			style={{
				marginTop: '-200px',
				width: 360,
				background: GUI_THEME.panel,
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 12,
				padding: 20,
			}}
		>
			<div
				style={{
					color: GUI_THEME.red,
					fontSize: 10,
					marginBottom: 8,
					letterSpacing: 1,
					textTransform: 'uppercase',
				}}
			>
				{eyebrow}
			</div>

			<h2 style={{margin: '0 0 10px', fontSize: 13, color: GUI_THEME.primary}}>
				{heading}
			</h2>

			<p
				style={{
					margin: 0,
					fontSize: 12,
					lineHeight: 1.7,
					color: GUI_THEME.secondary,
				}}
			>
				{body}
			</p>

			<div
				style={{
					display: 'flex',
					justifyContent: 'flex-end',
					gap: 10,
					marginTop: 20,
				}}
			>
				{/* Focused rather than the confirm button: a stray Enter on a
				    destructive dialog should back out, not go through with it. */}
				<Button autoFocus type="button" variant="ghost" onClick={onClose}>
					cancel
				</Button>

				<Button type="submit" variant="primary" style={{color: GUI_THEME.red}}>
					{confirmLabel}
				</Button>
			</div>
		</form>
	</div>
);
