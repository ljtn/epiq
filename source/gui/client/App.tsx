import {useEffect, useRef, useState} from 'react';
import {IssueDetails} from './components/IssueDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {moveIssue} from './lib/gui-move-issue';
import {DropTarget, GuiState, Result} from './lib/gui-state.model';
import {GUI_THEME} from './lib/gui-theme';

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

const findIssue = (state: GuiState | null, issueId: string | null) => {
	if (!state || !issueId) return null;

	for (const swimlane of state.swimlanes) {
		const issue = swimlane.issues.find(issue => issue.id === issueId);
		if (issue) return issue;
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
	}, []);

	const selectedIssue = findIssue(state, selectedIssueId);

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
					padding: '0 18px',
					borderBottom: `1px solid ${GUI_THEME.line}`,
				}}
			>
				<strong style={{color: GUI_THEME.accent}}>Epiq</strong>

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 16,
						fontSize: 12,
					}}
				>
					<span style={{color: syncColor}}>● {syncStatus.msg}</span>

					<span
						style={{
							color: connected ? GUI_THEME.green : GUI_THEME.red,
						}}
					>
						● {connected ? 'connected' : 'disconnected'}
					</span>
				</div>
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
				/>
			</div>
		</div>
	);
};
