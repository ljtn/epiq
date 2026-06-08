import {useEffect, useRef, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {IssueDetails} from './components/IssueDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {moveIssue} from './lib/gui-move-issue';
import {DropTarget, GuiIssue, GuiState, Result} from './lib/gui-state.model';
import {GUI_THEME} from './lib/gui-theme';
import {Button} from './components/Button';

type SyncStatus = {
	status: 'synced' | 'failed' | 'syncing';
	msg: string;
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

export const colorFromString = (value: string) => {
	let hash = 0;

	for (let i = 0; i < value.length; i++) {
		hash = value.charCodeAt(i) + ((hash << 5) - hash);
	}

	return `hsl(${Math.abs(hash) % 360}, 70%, 65%)`;
};

const findIssue = (state: GuiState, issueId: string): GuiIssue | null => {
	for (const board of state.boards) {
		for (const swimlane of board.swimlanes) {
			const issue = swimlane.issues.find(issue => issue.id === issueId);
			if (issue) return issue;
		}
	}

	return null;
};

export const DropIndicator = () => (
	<div
		style={{
			height: 2,
			background: GUI_THEME.accent,
			borderRadius: 999,
			margin: '4px 8px 8px',
			boxShadow: `0 0 12px ${GUI_THEME.accent}`,
		}}
	/>
);

export const App = () => {
	const {boardId} = useParams<{boardId: string}>();
	const navigate = useNavigate();

	const [connected, setConnected] = useState(false);
	const [syncStatus, setSyncStatus] = useState<SyncStatus>({
		status: 'synced',
		msg: 'Idle',
	});
	const [state, setState] = useState<GuiState | null>(null);
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
	const [dragOverSwimlaneId, setDragOverSwimlaneId] = useState<string | null>(
		null,
	);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	const [boardMenuOpen, setBoardMenuOpen] = useState(false);

	const boardMenuRef = useRef<HTMLDivElement | null>(null);
	const socketRef = useRef<WebSocket | null>(null);

	const selectedBoard =
		state?.boards.find(board => board.id === boardId) ??
		state?.boards[0] ??
		null;

	useEffect(() => {
		const socket = new WebSocket(
			`ws://${window.location.host}/ws${boardId ? `?boardId=${boardId}` : ''}`,
		);

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

			if (message.type === 'sync-status') {
				setSyncStatus(message.payload);
			}
		});

		return () => {
			if (socketRef.current === socket) {
				socketRef.current = null;
			}

			socket.close();
		};
	}, [boardId]);

	useEffect(() => {
		if (!boardId && state?.boards[0]) {
			navigate(`/board/${state.boards[0].id}`, {replace: true});
		}
	}, [boardId, state, navigate]);

	useEffect(() => {
		const close = (event: MouseEvent) => {
			if (
				boardMenuRef.current &&
				!boardMenuRef.current.contains(event.target as Node)
			) {
				setBoardMenuOpen(false);
			}
		};

		document.addEventListener('mousedown', close);
		return () => document.removeEventListener('mousedown', close);
	}, []);

	const selectedIssue =
		state && selectedIssueId ? findIssue(state, selectedIssueId) : null;

	const syncColor =
		syncStatus.status === 'failed'
			? GUI_THEME.red
			: syncStatus.status === 'syncing'
			? GUI_THEME.accent
			: GUI_THEME.green;

	const clearDragState = () => {
		setDragOverSwimlaneId(null);
		setDropTarget(null);
	};

	const editIssueTitle = (issueId: string, title: string) => {
		socketRef.current?.send(
			JSON.stringify({
				type: 'issue:edit:title',
				payload: {issueId, title},
			}),
		);
	};

	const editIssueDescription = (issueId: string, description: string) => {
		socketRef.current?.send(
			JSON.stringify({
				type: 'issue:edit:description',
				payload: {issueId, description},
			}),
		);
	};

	const addIssueTag = (issueId: string, tagName: string) => {
		socketRef.current?.send(
			JSON.stringify({
				type: 'issue:tag:add',
				payload: {issueId, tagName},
			}),
		);
	};

	const removeIssueTag = (issueId: string, tagId: string) => {
		socketRef.current?.send(
			JSON.stringify({
				type: 'issue:tag:remove',
				payload: {issueId, tagId},
			}),
		);
	};

	const addIssueAssignee = (issueId: string, assigneeName: string) => {
		socketRef.current?.send(
			JSON.stringify({
				type: 'issue:assignee:add',
				payload: {issueId, assigneeName},
			}),
		);
	};

	const removeIssueAssignee = (issueId: string, assigneeId: string) => {
		socketRef.current?.send(
			JSON.stringify({
				type: 'issue:assignee:remove',
				payload: {issueId, assigneeId},
			}),
		);
	};

	const selectBoard = (nextBoardId: string) => {
		setBoardMenuOpen(false);
		setSelectedIssueId(null);
		clearDragState();

		navigate(`/board/${nextBoardId}`);
	};

	return (
		<div
			style={{
				height: '100vh',
				background: GUI_THEME.bg,
				color: GUI_THEME.primary,
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
					padding: '0 30px',
					borderBottom: `1px solid ${GUI_THEME.line}`,
				}}
			>
				<span style={{color: GUI_THEME.accent, fontSize: '12px'}}>:epiq</span>

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 16,
						fontSize: 10,
					}}
				>
					<span style={{color: syncColor}}>● {syncStatus.msg}</span>|
					<span
						style={{
							color: connected ? GUI_THEME.green : GUI_THEME.red,
						}}
					>
						{connected ? 'connected' : 'disconnected'}
					</span>
				</div>
			</header>

			<div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
				<main style={{padding: '0 30px 30px 30px', overflow: 'auto', flex: 1}}>
					<div
						ref={boardMenuRef}
						style={{
							position: 'relative',
							padding: '30px 10px',
							width: 'fit-content',
							display: 'flex',
							alignItems: 'center',
							gap: 12,
						}}
					>
						<span style={{color: GUI_THEME.secondary, fontSize: '12px'}}>
							Board:
						</span>
						<Button
							variant="ghost"
							onClick={() => setBoardMenuOpen(open => !open)}
							style={{
								display: 'flex',
								alignItems: 'center',
								width: 100,
							}}
						>
							<span>{selectedBoard?.title ?? 'Loading...'}</span>

							<span
								style={{
									marginLeft: 'auto',
									color: GUI_THEME.dim,
									fontSize: '12px',
									display: 'inline-block',
									transform: boardMenuOpen ? 'rotate(90deg)' : 'rotate(0deg)',
									transition: 'transform 120ms ease',
								}}
							>
								❯
							</span>
						</Button>
						{boardMenuOpen && state?.boards.length ? (
							<div
								style={{
									position: 'absolute',
									top: 52,
									left: 0,
									minWidth: 220,
									background: GUI_THEME.bg,
									border: `1px solid ${GUI_THEME.line}`,
									borderRadius: 8,
									boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
									padding: 6,
									zIndex: 10,
								}}
							>
								{state.boards.map(board => {
									const selected = board.id === selectedBoard?.id;

									return (
										<button
											key={board.id}
											type="button"
											onClick={() => selectBoard(board.id)}
											style={{
												width: '100%',
												display: 'flex',
												justifyContent: 'space-between',
												alignItems: 'center',
												border: 'none',
												background: selected ? GUI_THEME.line : 'transparent',
												color: selected ? GUI_THEME.accent : GUI_THEME.primary,
												fontFamily: 'inherit',
												fontSize: 11,
												textAlign: 'left',
												padding: '8px 10px',
												borderRadius: 6,
												cursor: 'pointer',
											}}
										>
											<span>{board.title}</span>
											{selected ? <span>✓</span> : null}
										</button>
									);
								})}
							</div>
						) : null}
					</div>

					<div style={{display: 'flex', gap: 16}}>
						{selectedBoard?.swimlanes.map(swimlane => (
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
								onDropIssue={moveIssue(setState, socketRef)}
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
					onEditTitle={editIssueTitle}
					onEditDescription={editIssueDescription}
					onAddAssignee={addIssueAssignee}
					onAddTag={addIssueTag}
					onRemoveAssignee={removeIssueAssignee}
					onRemoveTag={removeIssueTag}
				/>
			</div>
		</div>
	);
};
