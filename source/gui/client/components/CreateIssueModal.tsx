import {Button} from './Button';
import {GUI_THEME} from '../lib/gui-theme';

type Props = {
	title: string;
	onChangeTitle: (title: string) => void;
	onCreate: () => void;
	onClose: () => void;
};

export const CreateIssueModal = ({
	title,
	onChangeTitle,
	onCreate,
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
			onSubmit={event => {
				event.preventDefault();
				onCreate();
			}}
			onMouseDown={event => event.stopPropagation()}
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
					color: GUI_THEME.accent,
					fontSize: 10,
					marginBottom: 8,
					letterSpacing: 1,
					textTransform: 'uppercase',
				}}
			>
				New issue
			</div>

			<h2
				style={{
					margin: '0 0 20px',
					fontSize: 10,
					color: GUI_THEME.primary,
				}}
			>
				title
			</h2>

			<input
				autoFocus
				value={title}
				placeholder="issue name"
				onChange={event => onChangeTitle(event.target.value)}
				onKeyDown={event => {
					if (event.key === 'Escape') {
						onClose();
					}
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

			<div
				style={{
					display: 'flex',
					justifyContent: 'flex-end',
					gap: 10,
					marginTop: 20,
				}}
			>
				<Button variant="ghost" onClick={onClose}>
					cancel
				</Button>

				<Button variant="primary">create</Button>
			</div>
		</form>
	</div>
);
