import {Button} from './Button';
import {Panel} from './Panel';
import {GUI_THEME} from '../lib/gui-theme';

type Props = {
	// The directory the server searched from, so the screen can name it rather
	// than leave the reader guessing which folder the GUI was pointed at.
	repoRoot: string;
	message: string;
	onRetry: () => void;
};

const codeStyle = {
	background: GUI_THEME.panel2,
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 6,
	padding: '2px 6px',
	color: GUI_THEME.primary,
};

export const InitProjectScreen = ({repoRoot, message, onRetry}: Props) => (
	<div
		data-testid="init-project-screen"
		style={{
			height: '100vh',
			background: GUI_THEME.bg,
			color: GUI_THEME.primary,
			fontFamily:
				'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			padding: 30,
		}}
	>
		<Panel
			proximityReach={300}
			style={{width: 520, background: GUI_THEME.panel}}
		>
			{/* Panel's own children wrapper carries no gap, so the column lives
			    here rather than in the panel's style. */}
			<div
				style={{
					padding: 28,
					display: 'flex',
					flexDirection: 'column',
					gap: 16,
				}}
			>
				<div
					style={{
						color: GUI_THEME.accent,
						fontSize: 10,
						letterSpacing: 1,
						textTransform: 'uppercase',
					}}
				>
					Initialize project
				</div>

				<h1 style={{margin: 0, fontSize: 16, fontWeight: 700}}>
					This folder is not an epiq project yet
				</h1>

				<div
					style={{fontSize: 12, color: GUI_THEME.secondary, lineHeight: 1.7}}
				>
					No <span style={codeStyle}>.epiq/project.json</span> was found in this
					directory or any of its parents:
				</div>

				<div
					style={{
						...codeStyle,
						fontSize: 12,
						padding: '10px 12px',
						wordBreak: 'break-all',
					}}
				>
					{repoRoot}
				</div>

				<div
					style={{fontSize: 12, color: GUI_THEME.secondary, lineHeight: 1.7}}
				>
					To start tracking issues here, run <span style={codeStyle}>epiq</span>{' '}
					in that folder and type <span style={codeStyle}>:init</span>. That
					creates, commits and pushes{' '}
					<span style={codeStyle}>.epiq/project.json</span>. Then come back and
					reload.
				</div>

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: 12,
						marginTop: 4,
					}}
				>
					<span style={{fontSize: 10, color: GUI_THEME.dim}}>{message}</span>

					<Button variant="primary" onClick={onRetry}>
						check again
					</Button>
				</div>
			</div>
		</Panel>
	</div>
);
