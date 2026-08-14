import {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigate, useParams, useSearchParams} from 'react-router-dom';
import {ASIDE_WIDTH} from './components/Aside';
import {Button} from './components/Button';
import {CreateIssueModal} from './components/CreateIssueModal';
import {Dropdown} from './components/Dropdown';
import {Header} from './components/Header';
import {IssueDetails} from './components/IssueDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {GlobalScrollbarStyles} from './components/GlobalScrollbarStyles';
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
	const {boardId, issueId} = useParams<{
		boardId: string;
		issueId?: string;
	}>();

	const [searchParams, setSearchParams] = useSearchParams();

	const [connected, setConnected] = useState(false);
	const [syncStatus, setSyncStatus] = useState<SyncStatus>({
		status: 'synced',
		msg: 'idle',
	});
	const [state, setState] = useState<GuiState | null>(null);
	// Assignable people for the board on screen. Separate from
	// state.contributors (the registry), which stays empty until somebody is
	// explicitly assigned — including you.
	const [contributors, setContributors] = useState<GuiContributor[]>([]);

	// Held as one value, not two, because the scrubber derives its whole
	// coordinate system (earliest, latest, span, bucket count, per-series
	// normalisation) from both together. In separate state slots, whichever
	// reply arrived first re-rendered the chart against the other's stale
	// data — a visible flash of a different range and bucketing.
	const [history, setHistory] = useState<{
		timeline: GuiEventTimeline | null;
		commits: GuiCommitEntry[];
	}>({timeline: null, commits: []});
	// Replies are collected here until both halves for the latest request have
	// arrived, then committed in one setState.
	const pendingHistoryRef = useRef<{
		timeline?: GuiEventTimeline;
		commits?: GuiCommitEntry[];
	}>({});

	// Publishes the buffered pair once both halves are in, so the chart never
	// renders a half-updated window.
	//
	// KNOWN BUG (see board: "Scrubber history buffer can commit a mismatched
	// timeline/commits pair"): "both slots filled" does not prove both halves
	// came from the same request, because requestBoardHistory clears the
	// buffer. A reply from request A can pair with one from request B.
	const commitHistoryIfComplete = () => {
		const {timeline, commits} = pendingHistoryRef.current;
		if (!timeline || !commits) return;

		pendingHistoryRef.current = {};
		setHistory({timeline, commits});
	};
	const [commitInspectError, setCommitInspectError] = useState<string | null>(
		null,
	);
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

	const selectedTab =
		searchParams.get('tab') === 'comments' ? 'comments' : 'overview';
	const navigate = useNavigate();

	// Route params carry shorthand refs (full ids in old links still resolve).
	const selectedBoard =
		(state && boardId ? findBoard(state, boardId) : null) ??
		state?.boards[0] ??
		null;

	// The board's internal id, as opposed to `boardId` from the route, which is
	// its human-facing ref. The event timeline is scoped by this.
	const selectedBoardId = selectedBoard?.id ?? null;

	// The websocket handler is installed once and closes over the first
	// render's values, so the board it should re-request for is read from a
	// ref rather than from that stale closure.
	const selectedBoardIdRef = useRef<string | null>(selectedBoardId);
	selectedBoardIdRef.current = selectedBoardId;

	const boardSlug = selectedBoard?.ref ?? boardId;

	const selectedIssue = state && issueId ? findIssue(state, issueId) : null;

	// Paste-to-attach: the fastest screenshot flow. Text inputs keep their
	// native paste behavior.
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
		socketRef.current?.send(JSON.stringify({type: 'state:get'}));
	};

	useEffect(() => {
		const socket = new WebSocket(
			`ws://${window.location.host}/ws${boardId ? `?boardId=${boardId}` : ''}`,
		);

		socketRef.current = socket;

		socket.addEventListener('open', () => {
			setConnected(true);
			socket.send(JSON.stringify({type: 'state:get'}));
			// Deliberately does not request history here. The scrubber owns the
			// scope (and remembers it across sessions), so it drives that fetch
			// itself once `connected` flips — requesting from here could only
			// ever ask for the default all-time window, which would ignore a
			// stored Week/Month/Year selection on the first load.
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

				if (created && boardId) {
					void navigate(
						`/board/${boardId}/issue/${nodeRef(created.id)}?tab=overview`,
					);
				}
			}

			if (message.type === 'failed') {
				console.log('Failed', message);
				requestState();
			}

			if (message.type === 'timeline') {
				const nextTimeline = getResultValue<GuiEventTimeline>(message.payload);
				if (nextTimeline) {
					pendingHistoryRef.current.timeline = nextTimeline;
					commitHistoryIfComplete();
				}
			}

			// Contributors change as a side effect of assigning (an external
			// assignee creates one) and of redacting. Neither is covered by the
			// state broadcast, which carries board data rather than the
			// assignable-people list, so the list is re-requested explicitly.
			if (
				message.type === 'contributor:redact:result' ||
				message.type === 'issue:assignee:add:result'
			) {
				socketRef.current?.send(
					JSON.stringify({
						type: 'contributors:get',
						payload: {boardId: selectedBoardIdRef.current},
					}),
				);
			}

			if (message.type === 'contributors') {
				const next = getResultValue<GuiContributor[]>(message.payload);
				if (next) setContributors(next);
			}

			if (message.type === 'commits') {
				const nextCommits = getResultValue<GuiCommitEntry[]>(message.payload);
				if (nextCommits) {
					pendingHistoryRef.current.commits = nextCommits;
					commitHistoryIfComplete();
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
		socketRef.current?.send(JSON.stringify({type, payload}));
	};

	const selectIssue = (nextIssueId: string) => {
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
		// Optimistic, same as the external path below — the picker already
		// knows this person's name and colour, so there's no reason to wait for
		// the round trip to show the chip.
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

	// Clears an external contributor's display name. The id and every
	// assignment referencing it survive — see redactContributor.
	const redactContributor = (contributorId: string) => {
		send('contributor:redact', {contributorId});
	};

	// Separate entry point rather than a flag on the one above: this is the
	// path that can invent a person, and it should read that way at the call
	// site instead of hiding behind a boolean.
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

	// Always requested as a pair, which is what lets the replies be buffered
	// and applied together: each request produces exactly one reply of each
	// type (the server only sends these in response to a get — it never pushes
	// them), so a full buffer always corresponds to one requested window.
	const requestBoardHistory = useCallback(
		(start?: number, end?: number, allBoards?: boolean) => {
			const window = start !== undefined ? {start, end} : undefined;

			pendingHistoryRef.current = {};
			// The board scopes the event timeline but not the commit log: commits
			// belong to the repository as a whole, so filtering them per board
			// would be inventing a relationship that doesn't exist.
			socketRef.current?.send(
				JSON.stringify({
					type: 'timeline:get',
					// Omitting boardId is already how the API says "every board",
					// so "all boards" needs no separate concept — it just drops the
					// filter rather than enumerating what to include.
					payload: {
						...window,
						boardId: allBoards ? undefined : selectedBoardId,
					},
				}),
			);
			socketRef.current?.send(
				JSON.stringify({type: 'commits:get', payload: window}),
			);
		},
		[selectedBoardId],
	);

	// Assignable people are board-scoped, so they're refetched whenever the
	// board changes — not tied to the history window, which is about time
	// rather than about who is on the board.
	useEffect(() => {
		if (!connected) return;

		socketRef.current?.send(
			JSON.stringify({
				type: 'contributors:get',
				payload: {boardId: selectedBoardId},
			}),
		);
	}, [connected, selectedBoardId]);

	const inspectCommit = useCallback((sha: string) => {
		socketRef.current?.send(
			JSON.stringify({type: 'commit:inspect', payload: {sha}}),
		);
	}, []);

	useEffect(() => {
		if (!commitInspectError) return;

		const timeout = setTimeout(() => setCommitInspectError(null), 8000);
		return () => clearTimeout(timeout);
	}, [commitInspectError]);

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
						Couldn't open commit diff: {commitInspectError}
					</span>
					<button
						onClick={() => setCommitInspectError(null)}
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
			)}

			<Header state={state} connected={connected} syncStatus={syncStatus} />

			<TimeScrubber
				timeline={history.timeline}
				commits={history.commits}
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
				{/* Column layout so the board row below can claim exactly the
				    leftover height and scroll internally. Vertical overflow is
				    hidden here on purpose: the swimlanes size themselves to this
				    box, so nothing should ever spill out of it and put a second
				    scrollbar on the page next to the columns' own. */}
				<main
					style={{
						// No bottom padding: the board row is the horizontal scroll
						// container now, so any gap below it would strand its
						// scrollbar above a strip of dead page. The row runs to the
						// bottom edge instead, putting the scrollbar where one
						// expects to find it.
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

					{/* The board's horizontal scroll container. It used to be `main`,
					    but `main` also had to scroll vertically for the swimlanes,
					    which is what produced a page-level vertical bar alongside
					    each column's own. Scrolling sideways is this row's job;
					    scrolling down is each column's. */}
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
								onDropIssue={moveIssue(setState, socketRef)}
								onDragOver={setDragOverSwimlaneId}
								onDragOverIssue={(swimlaneId, index) =>
									setDropTarget({swimlaneId, index})
								}
								onDragLeave={clearDragState}
							/>
						))}

						{/* Invisible spacer, only present while the panel is closed, so
							this row's scrollWidth grows by exactly what its clientWidth
							gained by reclaiming the panel's space — keeping the max
							scrollLeft identical across open/closed and avoiding the
							clamp-triggered "bounce back" when scrolled far right. It
							never reduces the board's real width the way reserving box
							space in the flex row would. */}
						{!(selectedIssue && state?.user) && (
							<div style={{width: ASIDE_WIDTH, flexShrink: 0}} />
						)}
					</div>
				</main>

				{selectedIssue && state?.user && (
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
						onRedactContributor={redactContributor}
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
