import {useCallback, useEffect, useRef, useState} from 'react';
import {
	useMatch,
	useNavigate,
	useParams,
	useSearchParams,
} from 'react-router-dom';
import {ASIDE_WIDTH} from './components/Aside';
import {Button} from './components/Button';
import {CreateIssueModal} from './components/CreateIssueModal';
import {Dropdown} from './components/Dropdown';
import {Header} from './components/Header';
import {IssueDetails} from './components/IssueDetails';
import {BulkDetails} from './components/BulkDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {GlobalScrollbarStyles} from './components/GlobalScrollbarStyles';
import {ErrorToast} from './components/ErrorToast';
import {TimeScrubber} from './components/TimeScrubber';
import {moveIssue} from './lib/gui-move-issue';
import {DropTarget} from './lib/gui-result.model';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {
	findBoard,
	findIssue,
	getResultValue,
	updateIssueInGuiState,
} from './lib/gui-state-helper';
import {
	GuiCommitEntry,
	GuiContributor,
	GuiEventTimeline,
	GuiState,
} from './lib/gui-state.model';
import {sendSocketJson} from './lib/socket-send';
import {createHistoryBuffer} from './lib/history-buffer';
import {createMutationGate} from './lib/mutation-gate';
import {blobToBase64, compressImage} from './lib/compress-image';
import {AttachmentUploadStatus} from './components/IssueAttachments';
import {SyncStatus} from './lib/gui-sync-statusmodel';
import {GUI_THEME} from './lib/gui-theme';

type IssueDetailsTab = 'overview' | 'comments';

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

	// Read off the path rather than from route params: one route element serves
	// every board path, so selecting a ticket cannot swap the element and
	// remount the board.
	const issueMatch = useMatch('/board/:boardId/issue/:issueId');
	// Legacy form without the /issue/ segment, so old links keep working.
	const legacyIssueMatch = useMatch('/board/:boardId/:issueId');
	const issueId =
		issueMatch?.params.issueId ?? legacyIssueMatch?.params.issueId;

	const [searchParams, setSearchParams] = useSearchParams();

	const [connected, setConnected] = useState(false);
	const [syncStatus, setSyncStatus] = useState<SyncStatus>({
		status: 'synced',
		msg: 'idle',
	});
	const [state, setState] = useState<GuiState | null>(null);
	// Assignable people for the board on screen, unlike state.contributors, which
	// is the registry and stays empty until somebody is explicitly assigned.
	const [contributors, setContributors] = useState<GuiContributor[]>([]);

	// One value, not two: the scrubber derives its coordinate system from both,
	// so applying either alone draws the chart against a range it doesn't match.
	const [history, setHistory] = useState<{
		requestId: number;
		timeline: GuiEventTimeline | null;
		commits: GuiCommitEntry[];
	}>({requestId: 0, timeline: null, commits: []});
	const [historyBuffer] = useState(() => createHistoryBuffer(setHistory));
	const [commitInspectError, setCommitInspectError] = useState<string | null>(
		null,
	);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [dragOverSwimlaneId, setDragOverSwimlaneId] = useState<string | null>(
		null,
	);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	// Tickets picked for a bulk action. The route still tracks the single ticket
	// whose details are open, which is a different thing.
	const [pickedIssueIds, setPickedIssueIds] = useState<string[]>([]);
	const [boardMenuOpen, setBoardMenuOpen] = useState(false);
	const [createIssueModal, setCreateIssueModal] = useState<{
		swimlaneId: string;
		title: string;
	} | null>(null);

	const boardMenuRef = useRef<HTMLDivElement | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const [mutationGate] = useState(createMutationGate);

	const selectedTab =
		searchParams.get('tab') === 'comments' ? 'comments' : 'overview';
	const navigate = useNavigate();

	// Route params carry shorthand refs (full ids in old links still resolve).
	const selectedBoard =
		(state && boardId ? findBoard(state, boardId) : null) ??
		state?.boards[0] ??
		null;

	// The board's internal id, as opposed to `boardId` from the route, which is
	// its human-facing ref.
	const selectedBoardId = selectedBoard?.id ?? null;

	// The websocket handler is installed once and closes over the first render,
	// so it reads the current board from a ref rather than that stale closure.
	const selectedBoardIdRef = useRef<string | null>(selectedBoardId);
	selectedBoardIdRef.current = selectedBoardId;

	const boardSlug = selectedBoard?.ref ?? boardId;

	const selectedIssue = state && issueId ? findIssue(state, issueId) : null;

	useEffect(() => {
		const onPaste = (event: ClipboardEvent) => {
			if (!selectedIssue || selectedIssue.readonly) return;

			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.isContentEditable)
			) {
				return;
			}

			const files = Array.from(event.clipboardData?.items ?? [])
				.filter(item => item.kind === 'file' && item.type.startsWith('image/'))
				.map(item => item.getAsFile())
				.filter((file): file is File => Boolean(file));

			if (files.length === 0) return;

			event.preventDefault();
			void uploadIssueAttachments(selectedIssue.id, files);
		};

		window.addEventListener('paste', onPaste);
		return () => window.removeEventListener('paste', onPaste);
	});

	const closeIssueDetails = () => {
		if (!boardSlug) return;

		void navigate(`/board/${boardSlug}`);
	};

	const commentsByIssueId = state?.commentsByIssueId ?? {};
	const attachmentsByIssueId = state?.attachmentsByIssueId ?? {};
	const [attachmentUploadStatus, setAttachmentUploadStatus] =
		useState<AttachmentUploadStatus>({state: 'idle'});

	const requestState = () => {
		sendSocketJson(socketRef.current, {type: 'state:get'});
	};

	useEffect(() => {
		const socket = new WebSocket(
			`ws://${window.location.host}/ws${boardId ? `?boardId=${boardId}` : ''}`,
		);

		socketRef.current = socket;

		socket.addEventListener('open', () => {
			setConnected(true);
			mutationGate.reset();
			sendSocketJson(socket, {type: 'state:get'});
			// History is not requested here: the scrubber owns the scope and drives
			// that fetch itself, so asking here would ignore its stored selection.
		});

		socket.addEventListener('close', () => {
			setConnected(false);
			mutationGate.reset();

			if (socketRef.current === socket) {
				socketRef.current = null;
			}
		});

		socket.addEventListener('message', event => {
			const message = JSON.parse(event.data);

			mutationGate.received(message.type);

			if (message.type === 'state' && !mutationGate.holdsState()) {
				const nextState = getResultValue<GuiState>(message.payload);
				if (nextState) setState(nextState);
			}

			if (message.type === 'issue:created') {
				const created = getResultValue<{id: string}>(message.payload);

				if (created && boardId) {
					void navigate(
						`/board/${boardId}/issue/${nodeRef(created.id)}?tab=overview`,
					);
				}
			}

			// A refused mutation is otherwise invisible: the optimistic update is
			// simply undone by the state that follows, which reads as the board
			// ignoring the action.
			if (message.type === 'failed') {
				setActionError(
					typeof message.payload === 'string'
						? message.payload
						: 'The board refused that change',
				);
				requestState();
			}

			if (message.type === 'timeline') {
				const nextTimeline = getResultValue<GuiEventTimeline>(message.payload);
				if (nextTimeline) {
					historyBuffer.accept(message.requestId, {timeline: nextTimeline});
				}
			}

			// The state broadcast carries board data, not the assignable-people
			// list, so assigning and removing need an explicit re-request.
			if (
				message.type === 'contributor:remove:result' ||
				message.type === 'issue:assignee:add:result'
			) {
				sendSocketJson(socketRef.current, {
					type: 'contributors:get',
					payload: {boardId: selectedBoardIdRef.current},
				});
			}

			if (
				message.type === 'contributor:remove:result' &&
				message.payload?.status === 'fail'
			) {
				setRemoveError(
					`Couldn't remove a contributor: ${message.payload.message}`,
				);
			}

			if (message.type === 'contributors') {
				const next = getResultValue<GuiContributor[]>(message.payload);
				if (next) setContributors(next);
			}

			if (message.type === 'commits') {
				const nextCommits = getResultValue<GuiCommitEntry[]>(message.payload);
				if (nextCommits) {
					historyBuffer.accept(message.requestId, {commits: nextCommits});
				}
			}

			if (
				message.type === 'commit:inspect:result' &&
				message.payload?.status === 'fail'
			) {
				setCommitInspectError(message.payload.message);
			}

			if (
				message.type === 'time-travel:result' &&
				message.payload?.status === 'fail'
			) {
				console.log('Time travel failed', message);
				requestState();
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
	}, [boardId, navigate]);

	useEffect(() => {
		if (!boardId && state?.boards[0]) {
			void navigate(`/board/${state.boards[0].ref}`, {replace: true});
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

	const clearDragState = () => {
		setDragOverSwimlaneId(null);
		setDropTarget(null);
	};

	const send = (type: string, payload: unknown) => {
		mutationGate.sent(type);
		sendSocketJson(socketRef.current, {type, payload});
	};

	const togglePicked = (nextIssueId: string) => {
		setPickedIssueIds(current =>
			current.includes(nextIssueId)
				? current.filter(id => id !== nextIssueId)
				: [...current, nextIssueId],
		);
	};

	const clearPicked = () => setPickedIssueIds([]);

	const [bulkTagName, setBulkTagName] = useState('');
	const [bulkAssigneeName, setBulkAssigneeName] = useState('');

	// Every selected ticket, in board order, so the panel lists them the way the
	// columns do.
	const pickedIssues = (state?.boards ?? [])
		.flatMap(board => board.swimlanes)
		.flatMap(swimlane => swimlane.issues)
		.filter(issue => pickedIssueIds.includes(issue.id));

	// Each bulk action fans out to the per-issue message, so the server needs no
	// bulk API and every change stays one auditable event.
	const forPicked = (act: (issueId: string) => void) => {
		for (const issue of pickedIssues) act(issue.id);
	};

	const selectIssue = (nextIssueId: string, {toggle} = {toggle: false}) => {
		if (toggle) return togglePicked(nextIssueId);

		// A plain click both opens the ticket and makes it the selection, so a
		// following modifier-click extends from it instead of starting over.
		setPickedIssueIds([nextIssueId]);

		if (!boardSlug) return;

		void navigate(
			`/board/${boardSlug}/issue/${nodeRef(nextIssueId)}?tab=overview`,
		);
	};

	const selectIssueComments = (nextIssueId: string) => {
		if (!boardSlug) return;

		void navigate(
			`/board/${boardSlug}/issue/${nodeRef(nextIssueId)}?tab=comments`,
		);
	};

	const changeIssueDetailsTab = (nextTab: IssueDetailsTab) => {
		setSearchParams(
			prev => {
				const next = new URLSearchParams(prev);
				next.set('tab', nextTab);
				return next;
			},
			{replace: true},
		);
	};

	const editIssueTitle = (issueId: string, title: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				title,
			}));
		});

		send('issue:edit:title', {issueId, title});
	};

	const editIssueDescription = (issueId: string, description: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				description,
			}));
		});

		send('issue:edit:description', {issueId, description});
	};

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

	const addIssueAssignee = (issueId: string, assigneeId: string) => {
		const picked = contributors.find(c => c.id === assigneeId);

		setState(prev => {
			if (!prev || !picked) return prev;

			return updateIssueInGuiState(prev, issueId, issue =>
				issue.assignees.some(assignee => assignee.id === assigneeId)
					? issue
					: {...issue, assignees: [...issue.assignees, picked]},
			);
		});

		send('issue:assignee:add', {issueId, assigneeId});
	};

	// Clears the display name only; the id and every assignment survive.
	const removeContributor = (contributorId: string) => {
		send('contributor:remove', {contributorId});
	};

	// Invent a person who has no record at all in the in the event logs.
	const addExternalIssueAssignee = (issueId: string, assigneeName: string) => {
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

		send('issue:assignee:add', {issueId, assigneeName, createUnlinked: true});
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

	const closeIssue = (issueId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				isClosed: true,
			}));
		});

		send('issue:close', {issueId});
	};

	const reopenIssue = (issueId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				isClosed: false,
			}));
		});

		send('issue:reopen', {issueId});
	};

	const scrubToTime = (targetTime: number) => {
		send('time-travel:scrub', {targetTime});
	};

	const returnToLive = () => {
		send('time-travel:live', {});
	};

	// Both requests carry the same id so their replies can be paired, and replies
	// to an abandoned request discarded.
	const requestBoardHistory = useCallback(
		(start?: number, end?: number, allBoards?: boolean) => {
			const window = start !== undefined ? {start, end} : undefined;

			const requestId = historyBuffer.open();
			// The board scopes the timeline but not the commit log, which is
			// repository-wide. Omitting boardId is how the API says "every board".
			sendSocketJson(socketRef.current, {
				type: 'timeline:get',
				payload: {
					...window,
					boardId: allBoards ? undefined : selectedBoardId,
					requestId,
				},
			});
			sendSocketJson(socketRef.current, {
				type: 'commits:get',
				payload: {...window, requestId},
			});
		},
		[selectedBoardId],
	);

	// Answering this replays the whole event log server-side, and the assignee
	// picker is its only reader — so it is fetched when that picker opens rather
	// than eagerly for every board.
	const requestContributors = useCallback(() => {
		sendSocketJson(socketRef.current, {
			type: 'contributors:get',
			payload: {boardId: selectedBoardIdRef.current},
		});
	}, []);

	// The list is board-scoped, so a board change must not leave the previous
	// board's people on screen until the next open re-fetches.
	useEffect(() => {
		setContributors([]);
		setPickedIssueIds([]);
	}, [selectedBoardId]);

	const inspectCommit = useCallback((sha: string) => {
		sendSocketJson(socketRef.current, {type: 'commit:inspect', payload: {sha}});
	}, []);

	useEffect(() => {
		if (!commitInspectError) return;

		const timeout = setTimeout(() => setCommitInspectError(null), 8000);
		return () => clearTimeout(timeout);
	}, [commitInspectError]);

	useEffect(() => {
		if (!removeError) return;

		const timeout = setTimeout(() => setRemoveError(null), 8000);
		return () => clearTimeout(timeout);
	}, [removeError]);

	useEffect(() => {
		if (!actionError) return;

		const timeout = setTimeout(() => setActionError(null), 8000);
		return () => clearTimeout(timeout);
	}, [actionError]);

	const selectBoard = (nextBoardId: string) => {
		setBoardMenuOpen(false);
		clearDragState();

		void navigate(`/board/${nodeRef(nextBoardId)}`);
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
		const parentId = createIssueModal.swimlaneId;

		setCreateIssueModal(null);

		send('issues:create', {
			title,
			parentId,
		});
	};

	const addIssueComment = (issueId: string, body: string) => {
		setState(prev => {
			if (!prev) return prev;

			const previousComments = prev.commentsByIssueId[issueId] ?? [];
			const placeholderComment = {
				id: `placeholder-comment-${crypto.randomUUID()}`,
				issueId,
				body,
				isDeleted: false,
				author: prev.user,
				createdAt: new Date().getTime(),
			} as (typeof previousComments)[number];

			return {
				...prev,
				commentsByIssueId: {
					...prev.commentsByIssueId,
					[issueId]: [...previousComments, placeholderComment],
				},
			};
		});

		send('issue:comment:add', {issueId, body});
	};

	const uploadIssueAttachments = async (issueId: string, files: File[]) => {
		for (const file of files) {
			setAttachmentUploadStatus({state: 'uploading', name: file.name});

			const compressed = await compressImage(file, state?.attachmentMaxKb);

			if ('error' in compressed) {
				setAttachmentUploadStatus({state: 'error', message: compressed.error});
				return;
			}

			try {
				const dataBase64 = await blobToBase64(compressed.blob);

				const response = await fetch('/api/attachments', {
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({
						issueId,
						name: compressed.name,
						dataBase64,
					}),
				});

				const payload = await response.json();

				if (!response.ok) {
					setAttachmentUploadStatus({
						state: 'error',
						message: payload?.message ?? 'Upload failed',
					});
					return;
				}

				const nextState = getResultValue<GuiState>(payload);
				if (nextState) setState(nextState);
			} catch (error) {
				setAttachmentUploadStatus({
					state: 'error',
					message: error instanceof Error ? error.message : 'Upload failed',
				});
				return;
			}
		}

		setAttachmentUploadStatus({state: 'idle'});
	};

	const deleteIssueAttachment = async (
		_issueId: string,
		attachmentId: string,
	) => {
		try {
			const response = await fetch(
				`/api/attachments/${encodeURIComponent(attachmentId)}`,
				{method: 'DELETE'},
			);

			const payload = await response.json();

			if (!response.ok) {
				setAttachmentUploadStatus({
					state: 'error',
					message: payload?.message ?? 'Unable to delete attachment',
				});
				return;
			}

			const nextState = getResultValue<GuiState>(payload);
			if (nextState) setState(nextState);
		} catch (error) {
			setAttachmentUploadStatus({
				state: 'error',
				message:
					error instanceof Error
						? error.message
						: 'Unable to delete attachment',
			});
		}
	};

	const deleteIssueComment = (_issueId: string, commentId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return {
				...prev,
				commentsByIssueId: Object.fromEntries(
					Object.entries(prev.commentsByIssueId).map(
						([nextIssueId, comments]) => [
							nextIssueId,
							comments.filter(comment => comment.id !== commentId),
						],
					),
				),
			};
		});

		send('issue:comment:delete', {commentId});
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
			<GlobalScrollbarStyles />

			{commitInspectError && (
				<ErrorToast
					message={`Couldn't open commit diff: ${commitInspectError}`}
					onDismiss={() => setCommitInspectError(null)}
				/>
			)}

			{removeError && (
				<ErrorToast
					message={removeError}
					onDismiss={() => setRemoveError(null)}
				/>
			)}

			{actionError && (
				<ErrorToast
					message={actionError}
					onDismiss={() => setActionError(null)}
				/>
			)}

			<Header state={state} connected={connected} syncStatus={syncStatus} />

			<TimeScrubber
				timeline={history.timeline}
				commits={history.commits}
				historyId={history.requestId}
				boardId={selectedBoardId}
				connected={connected}
				onRequestHistory={requestBoardHistory}
				onInspectCommit={inspectCommit}
				timeTravel={state?.timeTravel ?? {mode: 'live', asOfTime: null}}
				onScrub={scrubToTime}
				onReturnToLive={returnToLive}
			/>

			<div
				style={{
					display: 'flex',
					flex: 1,
					overflow: 'hidden',
				}}
			>
				{/* Vertical overflow is hidden here: the swimlanes size themselves to
				    this box, so anything spilling out would put a second scrollbar on
				    the page next to the columns' own. */}
				<main
					onClick={clearPicked}
					style={{
						// No bottom padding: the board row is the horizontal scroll
						// container, and a gap below it would strand its scrollbar.
						padding: '0 30px 0 30px',
						flex: 1,
						minHeight: 0,
						display: 'flex',
						flexDirection: 'column',
						overflow: 'hidden',
					}}
				>
					<div style={{padding: '20px 10px'}}>
						<Dropdown
							testId="board-switcher"
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

					{/* Scrolling sideways is this row's job; scrolling down is each
					    column's. Both on one element gives a page-level vertical bar
					    alongside each column's own. */}
					<div
						style={{
							display: 'flex',
							gap: 8,
							flex: 1,
							minHeight: 0,
							overflowX: 'auto',
							overflowY: 'hidden',
						}}
					>
						{selectedBoard?.swimlanes.map(swimlane => (
							<SwimlaneColumn
								key={swimlane.id}
								swimlane={swimlane}
								selected={false}
								selectedIssueId={selectedIssue?.id ?? null}
								commentsByIssueId={commentsByIssueId}
								dragOver={dragOverSwimlaneId === swimlane.id}
								dropIndex={
									dropTarget?.swimlaneId === swimlane.id
										? dropTarget.index
										: null
								}
								onSelectIssue={selectIssue}
								onSelectIssueComments={selectIssueComments}
								onCreateIssue={openCreateIssueModal}
								onDropIssue={(issueId, swimlaneId, targetIndex) => {
									const moving = pickedIssueIds.includes(issueId)
										? pickedIssueIds
										: [issueId];

									moveIssue(state, setState, send)(
										moving,
										swimlaneId,
										targetIndex,
									);
									clearPicked();
								}}
								pickedIssueIds={pickedIssueIds}
								onDragOver={setDragOverSwimlaneId}
								onDragOverIssue={(swimlaneId, index) =>
									setDropTarget({swimlaneId, index})
								}
								onDragLeave={clearDragState}
							/>
						))}

						{/* Grows scrollWidth by exactly what closing the panel gave back
							in clientWidth, keeping max scrollLeft identical across
							open/closed so the board doesn't bounce back when scrolled
							far right. */}
						{!(selectedIssue && state?.user) && (
							<div style={{width: ASIDE_WIDTH, flexShrink: 0}} />
						)}
					</div>
				</main>

				{pickedIssues.length > 1 && (
					<BulkDetails
						issues={pickedIssues}
						knownTags={state?.tags ?? []}
						knownAssignees={contributors}
						tagName={bulkTagName}
						assigneeName={bulkAssigneeName}
						onChangeTagName={setBulkTagName}
						onChangeAssigneeName={setBulkAssigneeName}
						onAddTag={name => {
							forPicked(id => addIssueTag(id, name));
							setBulkTagName('');
						}}
						onRemoveTag={tagId => forPicked(id => removeIssueTag(id, tagId))}
						onAddAssignee={assigneeId =>
							forPicked(id => addIssueAssignee(id, assigneeId))
						}
						onRemoveAssignee={assigneeId =>
							forPicked(id => removeIssueAssignee(id, assigneeId))
						}
						onCloseIssues={() => {
							forPicked(closeIssue);
							clearPicked();
						}}
						onReopenIssues={() => {
							forPicked(reopenIssue);
							clearPicked();
						}}
						onClear={clearPicked}
					/>
				)}

				{pickedIssues.length <= 1 && selectedIssue && state?.user && (
					<IssueDetails
						whoAmI={state.user}
						issue={selectedIssue}
						activeTab={selectedTab}
						comments={commentsByIssueId[selectedIssue.id] ?? []}
						onChangeTab={changeIssueDetailsTab}
						onClose={closeIssueDetails}
						onEditTitle={editIssueTitle}
						onEditDescription={editIssueDescription}
						onAddTag={addIssueTag}
						onRemoveTag={removeIssueTag}
						onAddAssignee={addIssueAssignee}
						onAddExternalAssignee={addExternalIssueAssignee}
						onRemoveContributor={removeContributor}
						onRemoveAssignee={removeIssueAssignee}
						onAddComment={addIssueComment}
						onDeleteComment={deleteIssueComment}
						attachments={attachmentsByIssueId[selectedIssue.id] ?? []}
						attachmentUploadStatus={attachmentUploadStatus}
						onUploadAttachments={uploadIssueAttachments}
						onDeleteAttachment={deleteIssueAttachment}
						onReopenIssue={reopenIssue}
						onCloseIssue={closeIssue}
						knownTags={state.tags ?? []}
						knownAssignees={contributors}
						onOpenAssigneePicker={requestContributors}
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
