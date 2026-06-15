import {useEffect, useRef, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {Dropdown} from './components/Dropdown';
import {Header} from './components/Header';
import {IssueDetails} from './components/IssueDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {moveIssue} from './lib/gui-move-issue';
import {
	findIssue,
	getResultValue,
	updateIssueInGuiState,
} from './lib/gui-state-helper';
import {GuiState} from './lib/gui-state.model';
import {DropTarget} from './lib/gui-result.model';
import {SyncStatus} from './lib/gui-sync-statusmodel';
import {GUI_THEME} from './lib/gui-theme';
import {Button} from './components/Button';
import {CreateIssueModal} from './components/CreateIssueModal';

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
		msg: 'idle',
	});
	const [state, setState] = useState<GuiState | null>(null);
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
	const [dragOverSwimlaneId, setDragOverSwimlaneId] = useState<string | null>(
		null,
	);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	const [boardMenuOpen, setBoardMenuOpen] = useState(false);
	const [createIssueModal, setCreateIssueModal] = useState<{
		swimlaneId: string;
		title: string;
	} | null>(null);

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

			if (message.type === 'state') {
				const nextState = getResultValue<GuiState>(message.payload);
				if (nextState) setState(nextState);
			}

			if (message.type === 'issue:created') {
				const created = getResultValue<{id: string}>(message.payload);

				if (created) {
					setSelectedIssueId(created.id);
				}
			}

			if (message.type === 'failed') {
				console.log('Failed', message);
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

	const clearDragState = () => {
		setDragOverSwimlaneId(null);
		setDropTarget(null);
	};

	const send = (type: string, payload: unknown) => {
		socketRef.current?.send(JSON.stringify({type, payload}));
	};

	const editIssueTitle = (issueId: string, title: string) =>
		send('issue:edit:title', {issueId, title});

	const editIssueDescription = (issueId: string, description: string) =>
		send('issue:edit:description', {issueId, description});

	const addIssueTag = (issueId: string, tagName: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => {
				if (issue.tags.some(tag => tag.name === tagName)) return issue;

				return {
					...issue,
					tags: [
						...issue.tags,
						{
							id: `placeholder-tag-${tagName}`,
							name: tagName,
							color: GUI_THEME.dim,
						},
					],
				};
			});
		});

		send('issue:tag:add', {issueId, tagName});
	};

	const removeIssueTag = (issueId: string, tagId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				tags: issue.tags.filter(tag => tag.id !== tagId),
			}));
		});

		send('issue:tag:remove', {issueId, tagId});
	};

	const addIssueAssignee = (issueId: string, assigneeName: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => {
				if (issue.assignees.some(assignee => assignee.name === assigneeName)) {
					return issue;
				}

				return {
					...issue,
					assignees: [
						...issue.assignees,
						{
							id: `placeholder-assignee-${assigneeName}`,
							name: assigneeName,
							color: GUI_THEME.dim,
						},
					],
				};
			});
		});

		send('issue:assignee:add', {issueId, assigneeName});
	};

	const removeIssueAssignee = (issueId: string, assigneeId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				assignees: issue.assignees.filter(
					assignee => assignee.id !== assigneeId,
				),
			}));
		});

		send('issue:assignee:remove', {issueId, assigneeId});
	};

	const closeIssue = (issueId: string) => send('issue:close', {issueId});

	const reopenIssue = (issueId: string) => send('issue:reopen', {issueId});

	const selectBoard = (nextBoardId: string) => {
		setBoardMenuOpen(false);
		setSelectedIssueId(null);
		clearDragState();

		void navigate(`/board/${nextBoardId}`);
	};

	const openCreateIssueModal = (swimlaneId: string) => {
		setCreateIssueModal({
			swimlaneId,
			title: '',
		});
	};

	const createIssue = () => {
		if (!createIssueModal) return;

		const title = createIssueModal.title.trim() || 'New issue';

		send('issues:create', {
			title,
			parentId: createIssueModal.swimlaneId,
		});

		setCreateIssueModal(null);
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
			<Header state={state} connected={connected} syncStatus={syncStatus} />

			<div
				style={{
					display: 'flex',
					flex: 1,
					overflow: 'hidden',
				}}
			>
				<main style={{padding: '0 30px 30px 30px', overflow: 'auto', flex: 1}}>
					<div style={{padding: '20px 10px'}}>
						<Dropdown
							label="Board:"
							value={
								selectedBoard
									? {
											id: selectedBoard.id,
											label: selectedBoard.title,
									  }
									: null
							}
							items={
								state?.boards.map(board => ({
									id: board.id,
									label: board.title,
								})) ?? []
							}
							placeholder="Loading..."
							onSelect={selectBoard}
						/>
					</div>

					<div style={{display: 'flex', gap: 8}}>
						{state?.commentsByIssueId &&
							selectedBoard?.swimlanes.map(swimlane => (
								<SwimlaneColumn
									key={swimlane.id}
									swimlane={swimlane}
									selected={false}
									selectedIssueId={selectedIssueId}
									commentsByIssueId={state.commentsByIssueId}
									dragOver={dragOverSwimlaneId === swimlane.id}
									dropIndex={
										dropTarget?.swimlaneId === swimlane.id
											? dropTarget.index
											: null
									}
									onSelectIssue={setSelectedIssueId}
									onCreateIssue={openCreateIssueModal}
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

				{selectedIssue && state?.user && (
					<IssueDetails
						whoAmI={state?.user}
						issue={selectedIssue}
						comments={state?.commentsByIssueId[selectedIssue.id] ?? []}
						onClose={() => setSelectedIssueId(null)}
						onEditTitle={editIssueTitle}
						onEditDescription={editIssueDescription}
						onAddTag={addIssueTag}
						onRemoveTag={removeIssueTag}
						onAddAssignee={addIssueAssignee}
						onRemoveAssignee={removeIssueAssignee}
						onReopenIssue={reopenIssue}
						onCloseIssue={closeIssue}
						knownTags={state?.tags ?? []}
						knownAssignees={state?.contributors ?? []}
					/>
				)}
			</div>

			{createIssueModal && (
				<CreateIssueModal
					title={createIssueModal.title}
					onChangeTitle={title =>
						setCreateIssueModal(prev => (prev ? {...prev, title} : prev))
					}
					onCreate={createIssue}
					onClose={() => setCreateIssueModal(null)}
				/>
			)}
		</div>
	);
};
