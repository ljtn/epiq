import {GUI_THEME} from '../lib/gui-theme';

type Props = {
	message: string;
	onDismiss: () => void;
};

// Bottom-right, non-blocking notice for a failure that has no natural home on
// the page — a background action the user has already navigated away from.
// Dismissable by hand as well as on the caller's timer, since the text can be
// long enough to want a second read.
export const ErrorToast = ({message, onDismiss}: Props) => (
	<div
		style={{
			position: 'fixed',
			bottom: 20,
			right: 20,
			zIndex: 1000,
			maxWidth: 360,
			display: 'flex',
			alignItems: 'flex-start',
			gap: 8,
			fontSize: 12,
			color: GUI_THEME.primary,
			background: GUI_THEME.panel,
			border: `1px solid ${GUI_THEME.red}`,
			borderRadius: 8,
			padding: '10px 12px',
			boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
		}}
	>
		<span style={{flex: 1, minWidth: 0, overflowWrap: 'anywhere'}}>
			{message}
		</span>
		<button
			onClick={onDismiss}
			style={{
				background: 'transparent',
				border: 'none',
				color: GUI_THEME.dim,
				cursor: 'pointer',
				fontSize: 14,
				lineHeight: 1,
				padding: 0,
			}}
		>
			×
		</button>
	</div>
);
