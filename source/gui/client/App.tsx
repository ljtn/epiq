import React, {useEffect, useRef, useState} from 'react';

type GuiIssue = {
	id: string;
	title: string;
	description: string;
	readonly: boolean;
	tags: Array<{id: string; name: string}>;
	assignees: Array<{id: string; name: string}>;
};

type GuiSwimlane = {
	id: string;
	title: string;
	readonly: boolean;
	issues: GuiIssue[];
};

type GuiState = {
	board: {
		id: string;
		title: string;
	};
	swimlanes: GuiSwimlane[];
};

type Result<T> = {
	value?: T;
	content?: Array<{type: string; text: string}>;
};

type DropTarget = {
	swimlaneId: string;
	index: number;
};

const theme = {
	bg: '#090a0f',
	panel: '#11141b',
	panel2: '#151a24',
	line: 'rgba(255,255,255,0.10)',
	primary: '#eef2ff',
	secondary: '#7f8aa3',
	accent: '#76e4ff',
	green: '#8ce99a',
	red: '#ff8787',
};

const getResultValue = <T,>(payload: Result<T> | T): T | undefined => {
	if (!payload) return undefined;

	if (
		typeof payload === 'object' &&
		payload !== null &&
		'value' in payload &&
		payload.value
	) {
		return payload.value;
	}

	if (
		typeof payload === 'object' &&
		payload !== null &&
		'content' in payload &&
		payload.content?.[0]?.text
	) {
		return JSON.parse(payload.content[0].text).value as T;
	}

	return payload as T;
};

const colorFromString = (value: string) => {
	let hash = 0;

	for (let i = 0; i < value.length; i++) {
		hash = value.charCodeAt(i) + ((hash << 5) - hash);
	}

	return `hsl(${Math.abs(hash) % 360}, 70%, 65%)`;
};

const findIssue = (state: GuiState | null, issueId: string | null) => {
	if (!state || !issueId) return null;

	for (const swimlane of state.swimlanes) {
		const issue = swimlane.issues.find(issue => issue.id === issueId);
		if (issue) return issue;
	}

	return null;
};

const getAdjustedTargetIndex = ({
	state,
	issueId,
	parentId,
	targetIndex,
}: {
	state: GuiState | null;
	issueId: string;
	parentId: string;
	targetIndex: number;
}) => {
	if (!state) return targetIndex;

	const targetSwimlane = state.swimlanes.find(
		swimlane => swimlane.id === parentId,
	);
	if (!targetSwimlane) return targetIndex;

	const currentIndex = targetSwimlane.issues.findIndex(
		issue => issue.id === issueId,
	);

	if (currentIndex === -1) return targetIndex;
	if (currentIndex < targetIndex) return targetIndex - 1;

	return targetIndex;
};

const DropIndicator = () => (
	<div
		style={{
			height: 2,
			background: theme.accent,
			borderRadius: 999,
			margin: '4px 8px 8px',
			boxShadow: `0 0 12px ${theme.accent}`,
		}}
	/>
);

const TicketCard = ({
	ticket,
	index,
	isSelected,
	onSelect,
	onDragStart,
	onDragOverIssue,
	onDropIssueAt,
}: {
	ticket: GuiIssue;
	index: number;
	isSelected: boolean;
	onSelect: () => void;
	onDragStart: () => void;
	onDragOverIssue: (targetIndex: number) => void;
	onDropIssueAt: (issueId: string, targetIndex: number) => void;
}) => (
	<div
		draggable={!ticket.readonly}
		onClick={onSelect}
		onDragStart={event => {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', ticket.id);
			onDragStart();
		}}
		onDragOver={event => {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';

			const rect = event.currentTarget.getBoundingClientRect();
			const isAfterMiddle = event.clientY > rect.top + rect.height / 2;

			onDragOverIssue(index + (isAfterMiddle ? 1 : 0));
		}}
		onDrop={event => {
			event.preventDefault();
			event.stopPropagation();

			const issueId = event.dataTransfer.getData('text/plain');
			if (!issueId || issueId === ticket.id) return;

			const rect = event.currentTarget.getBoundingClientRect();
			const isAfterMiddle = event.clientY > rect.top + rect.height / 2;

			onDropIssueAt(issueId, index + (isAfterMiddle ? 1 : 0));
		}}
		style={{
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: 12,
			color: isSelected ? theme.accent : theme.primary,
			fontSize: 12,
			cursor: ticket.readonly ? 'default' : 'grab',
			background: isSelected ? 'rgba(118,228,255,0.08)' : '#ffffff08',
			padding: '0 12px',
			height: '48px',
			borderRadius: '12px',
			marginBottom: 4,
		}}
	>
		<div style={{display: 'flex', gap: 10, minWidth: 0}}>
			<div
				style={{
					width: 28,
					color: isSelected ? theme.accent : theme.secondary,
					fontVariantNumeric: 'tabular-nums',
				}}
			>
				{isSelected ? '❯' : index + 1}
			</div>

			<div
				style={{
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{ticket.title}
			</div>
		</div>

		<div style={{display: 'flex', gap: 8, flexShrink: 0}}>
			{ticket.tags.map(tag => (
				<span
					key={tag.id}
					style={{
						color: colorFromString(tag.name),
						border: `1px solid ${theme.line}`,
						borderRadius: 999,
						padding: '4px 8px',
					}}
				>
					■ {tag.name}
				</span>
			))}

			{ticket.assignees.map(assignee => (
				<span
					key={assignee.id}
					title={assignee.name}
					style={{
						color: colorFromString(assignee.name),
						fontSize: 12,
						fontWeight: 700,
					}}
				>
					@{assignee.name.at(0)}
				</span>
			))}
		</div>
	</div>
);

const SwimlaneColumn = ({
	swimlane,
	selected,
	selectedIssueId,
	dragOver,
	dropIndex,
	onSelectIssue,
	onDropIssue,
	onDragOver,
	onDragOverIssue,
	onDragLeave,
}: {
	swimlane: GuiSwimlane;
	selected: boolean;
	selectedIssueId: string | null;
	dragOver: boolean;
	dropIndex: number | null;
	onSelectIssue: (issueId: string) => void;
	onDropIssue: (
		issueId: string,
		swimlaneId: string,
		targetIndex: number | 'end',
	) => void;
	onDragOver: (swimlaneId: string) => void;
	onDragOverIssue: (swimlaneId: string, targetIndex: number) => void;
	onDragLeave: () => void;
}) => (
	<section
		onDragOver={event => {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
			onDragOver(swimlane.id);

			if (swimlane.issues.length === 0) {
				onDragOverIssue(swimlane.id, 0);
			}
		}}
		onDragLeave={event => {
			if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
				onDragLeave();
			}
		}}
		onDrop={event => {
			event.preventDefault();
			onDragLeave();

			const issueId = event.dataTransfer.getData('text/plain');
			if (!issueId) return;

			onDropIssue(issueId, swimlane.id, dropIndex ?? 'end');
		}}
		style={{
			width: 360,
			minWidth: 360,
			height: 'calc(100vh - 128px)',
			background: dragOver ? '#14202a' : 'rgb(17 20 27 / 0%)',
			border: `1px solid ${selected || dragOver ? theme.accent : theme.line}`,
			borderRadius: 14,
			padding: '0 14px',
			display: 'flex',
			flexDirection: 'column',
		}}
	>
		<header
			style={{
				height: 48,
				display: 'flex',
				fontSize: 12,
				alignItems: 'center',
				gap: 8,
				borderBottom: `1px solid ${theme.line}`,
			}}
		>
			<span style={{color: selected ? theme.accent : theme.secondary}}>
				{selected ? '❯' : ' '}
			</span>

			<strong style={{color: selected ? theme.accent : theme.primary}}>
				{swimlane.title}
			</strong>

			<span style={{color: theme.secondary}}>({swimlane.issues.length})</span>

			{swimlane.readonly && <span>🔒</span>}
		</header>

		<div style={{overflow: 'auto', paddingTop: 4, flex: 1}}>
			{swimlane.issues.length === 0 ? (
				<>
					{dropIndex === 0 && <DropIndicator />}

					<div
						style={{
							padding: 24,
							textAlign: 'center',
							color: theme.secondary,
						}}
					>
						Drop issue here
					</div>
				</>
			) : (
				<>
					{swimlane.issues.map((ticket, index) => (
						<React.Fragment key={ticket.id}>
							{dropIndex === index && <DropIndicator />}

							<TicketCard
								ticket={ticket}
								index={index}
								isSelected={ticket.id === selectedIssueId}
								onSelect={() => onSelectIssue(ticket.id)}
								onDragStart={() => onSelectIssue(ticket.id)}
								onDragOverIssue={targetIndex =>
									onDragOverIssue(swimlane.id, targetIndex)
								}
								onDropIssueAt={(issueId, targetIndex) =>
									onDropIssue(issueId, swimlane.id, targetIndex)
								}
							/>
						</React.Fragment>
					))}

					{dropIndex === swimlane.issues.length && <DropIndicator />}
				</>
			)}
		</div>
	</section>
);

const IssueDetails = ({
	issue,
	onClose,
}: {
	issue: GuiIssue | null;
	onClose: () => void;
}) => (
	<aside
		style={{
			width: 380,
			minWidth: 380,
			borderLeft: `1px solid ${theme.line}`,
			background: theme.panel,
			padding: 18,
			fontSize: 12,
			overflow: 'auto',
		}}
	>
		{issue ? (
			<>
				<div
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						gap: 12,
						marginBottom: 18,
					}}
				>
					<strong style={{color: theme.accent}}>Issue details</strong>

					<button
						type="button"
						onClick={onClose}
						style={{
							background: 'transparent',
							border: `1px solid ${theme.line}`,
							color: theme.secondary,
							borderRadius: 8,
							cursor: 'pointer',
						}}
					>
						close
					</button>
				</div>

				<h2 style={{fontSize: 14, marginTop: 0}}>{issue.title}</h2>

				{issue.description ? (
					<p style={{lineHeight: 1.6, whiteSpace: 'pre-wrap'}}>
						{issue.description}
					</p>
				) : (
					<p style={{color: theme.secondary}}>No description</p>
				)}

				<div style={{marginTop: 24}}>
					<strong>Tags</strong>

					<div
						style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10}}
					>
						{issue.tags.length === 0 ? (
							<span style={{color: theme.secondary}}>No tags</span>
						) : (
							issue.tags.map(tag => (
								<span
									key={tag.id}
									style={{
										color: colorFromString(tag.name),
										border: `1px solid ${theme.line}`,
										borderRadius: 999,
										padding: '4px 8px',
									}}
								>
									■ {tag.name}
								</span>
							))
						)}
					</div>
				</div>

				<div style={{marginTop: 24}}>
					<strong>Assignees</strong>

					<div
						style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10}}
					>
						{issue.assignees.length === 0 ? (
							<span style={{color: theme.secondary}}>No assignees</span>
						) : (
							issue.assignees.map(assignee => (
								<span
									key={assignee.id}
									style={{
										color: colorFromString(assignee.name),
										border: `1px solid ${theme.line}`,
										borderRadius: 999,
										padding: '4px 8px',
									}}
								>
									@{assignee.name}
								</span>
							))
						)}
					</div>
				</div>
			</>
		) : (
			<div style={{color: theme.secondary}}>Select an issue</div>
		)}
	</aside>
);

export const App = () => {
	const [connected, setConnected] = useState(false);
	const [state, setState] = useState<GuiState | null>(null);
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
	const [dragOverSwimlaneId, setDragOverSwimlaneId] = useState<string | null>(
		null,
	);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

	const socketRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		socketRef.current = socket;

		socket.addEventListener('open', () => {
			setConnected(true);
			socket.send(JSON.stringify({type: 'state:get'}));
		});

		socket.addEventListener('close', () => {
			setConnected(false);

			if (socketRef.current === socket) {
				socketRef.current = null;
			}
		});

		socket.addEventListener('message', event => {
			const message = JSON.parse(event.data);
			console.log('WS', message);

			if (message.type === 'state') {
				const nextState = getResultValue<GuiState>(message.payload);
				if (nextState) setState(nextState);
			}
		});

		return () => {
			if (socketRef.current === socket) {
				socketRef.current = null;
			}

			socket.close();
		};
	}, []);

	const selectedIssue = findIssue(state, selectedIssueId);

	const clearDragState = () => {
		setDragOverSwimlaneId(null);
		setDropTarget(null);
	};

	const moveIssue = (
		issueId: string,
		parentId: string,
		targetIndex: number | 'end',
	) => {
		setState(current => {
			if (!current) return current;

			let movedIssue: GuiIssue | null = null;

			const swimlanesWithoutIssue = current.swimlanes.map(swimlane => {
				const issues = swimlane.issues.filter(issue => {
					if (issue.id !== issueId) return true;
					movedIssue = issue;
					return false;
				});

				return {...swimlane, issues};
			});

			if (!movedIssue) return current;

			return {
				...current,
				swimlanes: swimlanesWithoutIssue.map(swimlane => {
					if (swimlane.id !== parentId) return swimlane;

					const nextIssues = [...swimlane.issues];
					const index =
						targetIndex === 'end'
							? nextIssues.length
							: Math.max(0, Math.min(targetIndex, nextIssues.length));

					nextIssues.splice(index, 0, movedIssue!);

					return {...swimlane, issues: nextIssues};
				}),
			};
		});

		// Then send the actual persisted move.
		socketRef.current?.send(
			JSON.stringify({
				type: 'issues:move',
				payload: {
					issueId,
					parentId,
					position: {
						at: targetIndex,
					},
				},
			}),
		);
	};

	return (
		<div
			style={{
				height: '100vh',
				background: theme.bg,
				color: theme.primary,
				fontFamily:
					'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
				display: 'flex',
				flexDirection: 'column',
			}}
		>
			<header
				style={{
					height: 56,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '0 18px',
					borderBottom: `1px solid ${theme.line}`,
				}}
			>
				<strong style={{color: theme.accent}}>Epiq</strong>

				<span
					style={{color: connected ? theme.green : theme.red, fontSize: 12}}
				>
					● {connected ? 'connected' : 'disconnected'}
				</span>
			</header>

			<div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
				<main style={{padding: 24, overflow: 'auto', flex: 1}}>
					<h1 style={{marginTop: 0, fontSize: 16}}>
						{state?.board.title ?? 'Loading...'}
					</h1>

					<div style={{display: 'flex', gap: 16}}>
						{state?.swimlanes.map(swimlane => (
							<SwimlaneColumn
								key={swimlane.id}
								swimlane={swimlane}
								selected={false}
								selectedIssueId={selectedIssueId}
								dragOver={dragOverSwimlaneId === swimlane.id}
								dropIndex={
									dropTarget?.swimlaneId === swimlane.id
										? dropTarget.index
										: null
								}
								onSelectIssue={setSelectedIssueId}
								onDropIssue={moveIssue}
								onDragOver={setDragOverSwimlaneId}
								onDragOverIssue={(swimlaneId, index) =>
									setDropTarget({swimlaneId, index})
								}
								onDragLeave={clearDragState}
							/>
						))}
					</div>
				</main>

				<IssueDetails
					issue={selectedIssue}
					onClose={() => setSelectedIssueId(null)}
				/>
			</div>
		</div>
	);
};
