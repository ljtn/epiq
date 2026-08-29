import {Button} from './Button';
import {Panel} from './Panel';
import {GUI_THEME} from '../lib/gui-theme';

// Mirrors the server's view of the recent-projects registry; the client cannot
// import the Node-side module that defines it.
export type RecentProjectView = {
	projectId: string;
	name: string;
	root: string;
	lastOpenedAt: number;
};

type Props = {
	repoRoot: string;
	message: string;
	recentProjects?: RecentProjectView[];
	onRetry: () => void;
	onOpen: (root: string) => void;
};

const codeStyle = {
	background: GUI_THEME.panel2,
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 6,
	padding: '2px 6px',
	color: GUI_THEME.primary,
};

export const InitProjectScreen = ({
	repoRoot,
	message,
	recentProjects = [],
	onRetry,
	onOpen,
}: Props) => (
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

				{recentProjects.length > 0 && (
					<div
						data-testid="recent-projects"
						style={{display: 'flex', flexDirection: 'column', gap: 8}}
					>
						<div
							style={{
								color: GUI_THEME.accent,
								fontSize: 10,
								letterSpacing: 1,
								textTransform: 'uppercase',
							}}
						>
							Or open a recent project
						</div>

						{recentProjects.map(project => (
							<div
								key={project.projectId}
								data-testid="recent-project"
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									gap: 12,
									fontSize: 12,
								}}
							>
								<div style={{minWidth: 0}}>
									<div style={{fontWeight: 700}}>{project.name}</div>
									<div
										style={{
											color: GUI_THEME.dim,
											fontSize: 10,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
										title={project.root}
									>
										{project.root}
									</div>
								</div>

								<Button
									variant="primary"
									onClick={() => onOpen(project.root)}
									data-testid="open-recent-project"
								>
									open
								</Button>
							</div>
						))}
					</div>
				)}

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
