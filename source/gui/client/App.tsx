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

const findIssueParent = (state: GuiState | null, issueId: string) => {
	if (!state) return null;

	for (const swimlane of state.swimlanes) {
		if (swimlane.issues.some(issue => issue.id === issueId)) return swimlane.id;
	}

	return null;
};

const TicketCard = ({
	ticket,
	index,
	isSelected,
	onSelect,
	onDragStart,
}: {
	ticket: GuiIssue;
	index: number;
	isSelected: boolean;
	onSelect: () => void;
	onDragStart: () => void;
}) => (
	<div
		draggable={!ticket.readonly}
		onClick={onSelect}
		onDragStart={event => {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', ticket.id);
			onDragStart();
		}}
		style={{
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: 12,
			padding: '10px 0',
			borderBottom: `1px solid ${theme.line}`,
			color: isSelected ? theme.accent : theme.primary,
			fontSize: 14,
			cursor: ticket.readonly ? 'default' : 'grab',
			background: isSelected ? 'rgba(118,228,255,0.08)' : 'transparent',
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
					title={tag.name}
					style={{
						color: colorFromString(tag.name),
						fontSize: 14,
					}}
				>
					■
				</span>
			))}

			{ticket.assignees.map(assignee => (
				<span
					key={assignee.id}
					title={assignee.name}
					style={{
						color: colorFromString(assignee.name),
						fontSize: 13,
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
	onSelectIssue,
	onDropIssue,
	onDragOver,
	onDragLeave,
}: {
	swimlane: GuiSwimlane;
	selected: boolean;
	selectedIssueId: string | null;
	dragOver: boolean;
	onSelectIssue: (issueId: string) => void;
	onDropIssue: (issueId: string, swimlaneId: string) => void;
	onDragOver: (swimlaneId: string) => void;
	onDragLeave: () => void;
}) => (
	<section
		onDragOver={event => {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
			onDragOver(swimlane.id);
		}}
		onDragLeave={onDragLeave}
		onDrop={event => {
			event.preventDefault();
			onDragLeave();

			const issueId = event.dataTransfer.getData('text/plain');
			if (!issueId) return;

			onDropIssue(issueId, swimlane.id);
		}}
		style={{
			width: 360,
			minWidth: 360,
			height: 'calc(100vh - 128px)',
			background: dragOver ? '#14202a' : theme.panel,
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
				<div
					style={{
						padding: 24,
						textAlign: 'center',
						color: theme.secondary,
					}}
				>
					Drop issue here
				</div>
			) : (
				swimlane.issues.map((ticket, index) => (
					<TicketCard
						key={ticket.id}
						ticket={ticket}
						index={index}
						isSelected={ticket.id === selectedIssueId}
						onSelect={() => onSelectIssue(ticket.id)}
						onDragStart={() => onSelectIssue(ticket.id)}
					/>
				))
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

				<h2 style={{fontSize: 18, marginTop: 0}}>{issue.title}</h2>

				<div style={{color: theme.secondary, fontSize: 13, marginBottom: 18}}>
					{issue.id}
				</div>

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

	const moveIssue = (issueId: string, parentId: string) => {
		const movePayload1 = JSON.stringify({
			type: 'issues:move',
			payload: {
				issueId,
				parentId,
				position: {
					at: 'end',
				},
			},
		});
		console.log('Sending...', socketRef.current?.readyState);
		if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
			return;
		}

		console.log('issue parent...', findIssueParent(state, issueId), parentId);
		if (findIssueParent(state, issueId) === parentId) return;

		const movePayload = JSON.stringify({
			type: 'issues:move',
			payload: {
				issueId,
				parentId,
				position: {
					at: 'end',
				},
			},
		});
		console.log('Sending move payload', movePayload);
		socketRef.current.send(movePayload);
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

				<span style={{color: connected ? theme.green : theme.red}}>
					● {connected ? 'connected' : 'disconnected'}
				</span>
			</header>

			<div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
				<main style={{padding: 24, overflow: 'auto', flex: 1}}>
					<h1 style={{marginTop: 0, fontSize: 20}}>
						{state?.board.title ?? 'Loading...'}
					</h1>

					<div style={{display: 'flex', gap: 16}}>
						{state?.swimlanes.map((swimlane, index) => (
							<SwimlaneColumn
								key={swimlane.id}
								swimlane={swimlane}
								selected={index === 0}
								selectedIssueId={selectedIssueId}
								dragOver={dragOverSwimlaneId === swimlane.id}
								onSelectIssue={setSelectedIssueId}
								onDropIssue={moveIssue}
								onDragOver={setDragOverSwimlaneId}
								onDragLeave={() => setDragOverSwimlaneId(null)}
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
