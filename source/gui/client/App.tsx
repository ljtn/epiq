import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	useMatch,
	useNavigate,
	useParams,
	useSearchParams,
} from 'react-router-dom';
import {
	Aside,
	readStoredAsideWidth,
	STACKED_DIFF_WIDTH,
} from './components/Aside';
import {Button} from './components/Button';
import {CreateNodeModal} from './components/CreateNodeModal';
import {AddSwimlaneColumn} from './components/AddSwimlaneColumn';
import {ConfirmModal} from './components/ConfirmModal';
import {DiffPanel} from './components/DiffPanel';
import {InitProjectScreen} from './components/InitProjectScreen';
import {Dropdown} from './components/Dropdown';
import {Header} from './components/Header';
import {IssueDetails} from './components/IssueDetails';
import {BulkDetails} from './components/BulkDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {GlobalScrollbarStyles} from './components/GlobalScrollbarStyles';
import {ErrorToast} from './components/ErrorToast';
import {TimeScrubber} from './components/TimeScrubber';
import {moveIssue} from './lib/gui-move-issue';
import {reconnectDelayMs} from './lib/reconnect';
import {moveSwimlane} from './lib/gui-move-swimlane';
import {DropTarget} from './lib/gui-result.model';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {
	findBoard,
	findIssue,
	getResultValue,
	updateIssueInGuiState,
	updateSwimlaneInGuiState,
} from './lib/gui-state-helper';
import {
	GuiComment,
	GuiCommitDiff,
	GuiCommitDiffFile,
	GuiIssue,
	GuiIssueHistoryEntry,
	GuiCommitEntry,
	GuiRefCommitEntry,
	GuiContributor,
	GuiEventTimeline,
	GuiState,
	GuiSwimlane,
} from './lib/gui-state.model';
import {BoardFilter, issuePassesBoardFilter} from './lib/scrubber';
import {sendSocketJson} from './lib/socket-send';
import {createHistoryBuffer} from './lib/history-buffer';
import {createMutationGate} from './lib/mutation-gate';
import {blobToBase64, compressImage} from './lib/compress-image';
import {AttachmentUploadStatus} from './components/IssueAttachments';
import {SyncStatus} from './lib/gui-sync-statusmodel';
import {GUI_THEME} from './lib/gui-theme';

type IssueDetailsTab = 'overview' | 'comments' | 'history' | 'code';

// Module scope so an absent state does not hand the memos below a new object
// on every render.
const EMPTY_COMMENTS: GuiState['commentsByIssueId'] = {};

// The board's page margin, matching the left padding on <main>.
const BOARD_GUTTER = 30;

export const DropIndicator = () => (
	<div
		data-testid="ticket-drop-indicator"
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
	// Bumped per socket, not per connection state: a socket the effect replaces
	// never reports a disconnect, so `connected` alone cannot tell a reader that
	// its outstanding requests died with the old socket.
	const [socketEpoch, setSocketEpoch] = useState(0);
	const [syncStatus, setSyncStatus] = useState<SyncStatus>({
		status: 'synced',
		msg: 'idle',
	});
	const [state, setState] = useState<GuiState | null>(null);
	// Set only when the server says there is nothing to load here — no epiq
	// project at or above its root. Distinct from `state === null`, which just
	// means the first broadcast has not arrived yet.
	const [noProject, setNoProject] = useState<{
		message: string;
		repoRoot: string;
	} | null>(null);
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
	const [commitDiff, setCommitDiff] = useState<{
		sha: string;
		loading: boolean;
		error: string | null;
		files: GuiCommitDiffFile[] | null;
	} | null>(null);
	// Tracks the resizable Aside's live width so DiffPanel can pick split vs.
	// unified — initialized from the same persisted value Aside itself reads,
	// so the first render already picks the right layout instead of flashing.
	const [commitDiffPanelWidth, setCommitDiffPanelWidth] =
		useState(readStoredAsideWidth);
	// The ticket detail Code tab's commit list. Reset per selected issue, like
	// issueDetail below — refetched fresh each time the tab opens rather than
	// cached, since a full ref-prefix log scan is cheap next to the round trip.
	const [issueCommits, setIssueCommits] = useState<{
		issueId: string;
		loading: boolean;
		error: string | null;
		commits: GuiRefCommitEntry[];
	} | null>(null);
	// Per-commit diffs for whichever commits are expanded in the Code tab.
	// Keyed by sha rather than nested under issueCommits so an expanded commit
	// survives a commits-list refetch (e.g. re-opening the tab).
	const [issueCommitDiffs, setIssueCommitDiffs] = useState<
		Record<
			string,
			{
				loading: boolean;
				error: string | null;
				files: GuiCommitDiffFile[] | null;
			}
		>
	>({});
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
	// Only a title: the board it lands on is whichever one is on screen.
	const [createSwimlaneTitle, setCreateSwimlaneTitle] = useState<string | null>(
		null,
	);
	const [renameSwimlane, setRenameSwimlane] = useState<{
		swimlaneId: string;
		title: string;
	} | null>(null);
	const [deleteSwimlaneId, setDeleteSwimlaneId] = useState<string | null>(null);
	// Which column edge the dragged swimlane would land on. Held as an edge
	// rather than an index so each column can draw its own line without needing
	// to know its position in the row.
	// Lifted here because the Log lives in the details pane and the scatter it
	// points at is drawn above the board.
	const [hoveredLogEventId, setHoveredLogEventId] = useState<string | null>(
		null,
	);
	const [swimlaneDropEdge, setSwimlaneDropEdge] = useState<{
		swimlaneId: string;
		side: 'left' | 'right';
	} | null>(null);

	const boardMenuRef = useRef<HTMLDivElement | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const [reconnectTick, setReconnectTick] = useState(0);
	// True once the automatic attempts are spent; the topbar then offers the
	// button rather than retrying behind the reader's back forever.
	const [reconnectExhausted, setReconnectExhausted] = useState(false);
	const reconnectAttempts = useRef(0);
	const reconnectTimer = useRef<number | null>(null);

	const reconnectNow = () => {
		reconnectAttempts.current = 0;
		setReconnectExhausted(false);
		setReconnectTick(tick => tick + 1);
	};
	const [mutationGate] = useState(createMutationGate);

	const tabParam = searchParams.get('tab');
	const selectedTab: IssueDetailsTab =
		tabParam === 'comments' || tabParam === 'history' || tabParam === 'code'
			? tabParam
			: 'overview';
	const navigate = useNavigate();

	// Route params carry shorthand refs (full ids in old links still resolve).
	// `boards` is optional-chained too: a repo with no epiq project yet sends a
	// state with no boards at all, and indexing straight into it throws during
	// render, unmounting the app to a white page.
	const selectedBoard =
		(state && boardId ? findBoard(state, boardId) : null) ??
		state?.boards?.[0] ??
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

	const commentsByIssueId = state?.commentsByIssueId ?? EMPTY_COMMENTS;

	// The board's state carries no descriptions or comment bodies — they are
	// most of its weight and nothing on the board draws them. Fetched here for
	// the one ticket whose details are open.
	const [issueDetail, setIssueDetail] = useState<{
		issueId: string;
		description: string;
		comments: GuiComment[];
		history: GuiIssueHistoryEntry[];
	} | null>(null);
	// Driven by the scrubber's own selection. Null unless it has been narrowed
	// to particular tags or people.
	const [boardFilter, setBoardFilter] = useState<BoardFilter | null>(null);

	// Memoized, and returning the lanes untouched when nothing is filtered:
	// rebuilding every swimlane object each render would hand SwimlaneColumn a
	// new identity every time and undo its memoization.
	const {visibleSwimlanes, hiddenIssueCount} = useMemo(() => {
		const swimlanes = selectedBoard?.swimlanes ?? [];
		if (!boardFilter) return {visibleSwimlanes: swimlanes, hiddenIssueCount: 0};

		let hidden = 0;

		const visible = swimlanes.map(swimlane => {
			const issues = swimlane.issues.filter(issue =>
				issuePassesBoardFilter(
					issue,
					(commentsByIssueId[issue.id] ?? []).map(comment => comment.author.id),
					boardFilter,
				),
			);

			hidden += swimlane.issues.length - issues.length;

			return {...swimlane, issues};
		});

		return {visibleSwimlanes: visible, hiddenIssueCount: hidden};
	}, [selectedBoard, boardFilter, commentsByIssueId]);
	const attachmentsByIssueId = state?.attachmentsByIssueId ?? {};
	const [attachmentUploadStatus, setAttachmentUploadStatus] =
		useState<AttachmentUploadStatus>({state: 'idle'});

	useEffect(() => {
		if (!selectedIssue) {
			setIssueDetail(null);
			return;
		}

		sendSocketJson(socketRef.current, {
			type: 'issue:get',
			payload: {issueId: selectedIssue.id},
		});
	}, [selectedIssue?.id, state]);

	// Keyed on the issue alone, not the tab: switching to Code and back must not
	// discard diffs already loaded there, only a genuinely different ticket should.
	useEffect(() => {
		setIssueCommitDiffs({});
	}, [selectedIssue?.id]);

	// Fetched lazily on entering the Code tab rather than alongside issue:get
	// above: a full ref-prefix log scan on every ticket selection would be
	// wasted on the common case where nobody opens the tab.
	useEffect(() => {
		if (!selectedIssue || selectedTab !== 'code') {
			setIssueCommits(null);
			return;
		}

		setIssueCommits({
			issueId: selectedIssue.id,
			loading: true,
			error: null,
			commits: [],
		});
		sendSocketJson(socketRef.current, {
			type: 'issue:commits:get',
			payload: {issueId: selectedIssue.id},
		});
	}, [selectedIssue?.id, selectedTab]);

	const loadIssueCommitDiff = useCallback((sha: string) => {
		setIssueCommitDiffs(prev => ({
			...prev,
			[sha]: {loading: true, error: null, files: null},
		}));
		sendSocketJson(socketRef.current, {
			type: 'commit:diff:get',
			payload: {sha},
		});
	}, []);

	const requestState = () => {
		sendSocketJson(socketRef.current, {type: 'state:get'});
	};

	useEffect(() => {
		const socket = new WebSocket(
			`ws://${window.location.host}/ws${boardId ? `?boardId=${boardId}` : ''}`,
		);

		socketRef.current = socket;
		// Distinguishes a socket the effect is tearing down from one that dropped
		// on its own; only the latter is worth reconnecting.
		let replaced = false;

		socket.addEventListener('open', () => {
			setConnected(true);
			setSocketEpoch(epoch => epoch + 1);
			reconnectAttempts.current = 0;
			setReconnectExhausted(false);
			mutationGate.reset();
			sendSocketJson(socket, {type: 'state:get'});
			// History is not requested here: the scrubber owns the scope and drives
			// that fetch itself, so asking here would ignore its stored selection.
		});

		socket.addEventListener('close', () => {
			if (socketRef.current === socket) {
				socketRef.current = null;
			}

			// A socket this effect is replacing is not a lost connection: the next
			// one is already opening. Reporting it would flash the whole offline
			// treatment on every navigation, which re-runs this effect.
			if (replaced) return;

			setConnected(false);
			mutationGate.reset();

			// Without this the board is dead until a manual reload: nothing arrives
			// and nothing is sent, while the controls carry on as if they worked.
			const delay = reconnectDelayMs(reconnectAttempts.current);

			if (delay === null) {
				setReconnectExhausted(true);
				return;
			}

			reconnectAttempts.current += 1;
			reconnectTimer.current = window.setTimeout(
				() => setReconnectTick(tick => tick + 1),
				delay,
			);
		});

		socket.addEventListener('message', event => {
			const message = JSON.parse(event.data);

			mutationGate.received(message.type);

			if (message.type === 'state' && !mutationGate.holdsState()) {
				const nextState = getResultValue<GuiState>(message.payload);
				if (nextState) {
					setState(nextState);
					setNoProject(null);
				}
			}

			if (message.type === 'state:unavailable') {
				setNoProject(message.payload);
			}

			if (message.type === 'issue') {
				const detail = getResultValue<{
					issueId: string;
					description: string;
					comments: GuiComment[];
					history: GuiIssueHistoryEntry[];
				}>(message.payload);

				if (detail) setIssueDetail(detail);
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

			if (message.type === 'commit:diff:result') {
				// Wrapped with the sha it was requested for: the scrubber's dot and
				// the ticket tab's commit list can each have a different commit's
				// diff in flight at once, and a failed Result alone carries no sha
				// to attribute the failure to.
				const {sha, result} = message.payload as {
					sha: string;
					result: {status: string; message: string; value?: GuiCommitDiff};
				};

				if (result?.status === 'fail') {
					// Ignores a reply for a sha no longer showing — a fast second click
					// can leave an earlier request in flight.
					setCommitDiff(prev =>
						prev && prev.sha === sha
							? {...prev, loading: false, error: result.message}
							: prev,
					);
					setIssueCommitDiffs(prev =>
						prev[sha]
							? {
									...prev,
									[sha]: {loading: false, error: result.message, files: null},
							  }
							: prev,
					);
				} else {
					const diff = getResultValue<GuiCommitDiff>(result);
					if (diff) {
						setCommitDiff(prev =>
							prev && prev.sha === diff.sha
								? {...prev, loading: false, error: null, files: diff.files}
								: prev,
						);
						setIssueCommitDiffs(prev =>
							prev[diff.sha]
								? {
										...prev,
										[diff.sha]: {
											loading: false,
											error: null,
											files: diff.files,
										},
								  }
								: prev,
						);
					}
				}
			}

			if (message.type === 'issue:commits:result') {
				// Wrapped with the issueId it was requested for: switching tickets
				// while the Code tab stays open can leave an older ticket's request
				// in flight, and a failed Result alone carries no issueId to check.
				const {issueId, result} = message.payload as {
					issueId: string;
					result: {
						status: string;
						message: string;
						value?: GuiRefCommitEntry[];
					};
				};

				if (result?.status === 'fail') {
					setIssueCommits(prev =>
						prev && prev.issueId === issueId
							? {...prev, loading: false, error: result.message}
							: prev,
					);
				} else {
					const commits = getResultValue<GuiRefCommitEntry[]>(result);
					if (commits) {
						setIssueCommits(prev =>
							prev && prev.issueId === issueId
								? {...prev, loading: false, error: null, commits}
								: prev,
						);
					}
				}
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
			replaced = true;

			if (reconnectTimer.current !== null) {
				clearTimeout(reconnectTimer.current);
				reconnectTimer.current = null;
			}

			if (socketRef.current === socket) {
				socketRef.current = null;
			}

			socket.close();
		};
		// `reconnectTick` is what re-runs this after a drop; the scrubber re-asks
		// for its window off `connected`, so history comes back with it.
	}, [boardId, navigate, reconnectTick]);

	useEffect(() => {
		const first = state?.boards?.[0];

		if (!boardId && first) {
			void navigate(`/board/${first.ref}`, {replace: true});
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

		// Carries the open tab across the selection: reading every ticket's
		// comments in turn should not mean reopening the tab each time.
		void navigate(
			`/board/${boardSlug}/issue/${nodeRef(nextIssueId)}?tab=${selectedTab}`,
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
	// Returns the id the reply will carry, so the caller can tell its own
	// window's answer from one still arriving for a window it has left.
	const requestBoardHistory = useCallback(
		(start?: number, end?: number, allBoards?: boolean): number => {
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

			return requestId;
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

	const openCommitDiff = useCallback((sha: string) => {
		setCommitDiff({sha, loading: true, error: null, files: null});
		sendSocketJson(socketRef.current, {
			type: 'commit:diff:get',
			payload: {sha},
		});
	}, []);

	const closeCommitDiff = useCallback(() => setCommitDiff(null), []);

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

	const createSwimlane = () => {
		if (createSwimlaneTitle === null || !selectedBoard) return;

		const title = createSwimlaneTitle.trim() || 'New swimlane';
		const boardId = selectedBoard.id;

		setCreateSwimlaneTitle(null);

		// Placeholder id: the real one arrives with the state that follows. Marked
		// readonly until then, which hides the kebab and disables `+` — both would
		// otherwise send this id, and the server has never heard of it.
		setState(prev =>
			prev
				? {
						...prev,
						boards: prev.boards.map(board =>
							board.id === boardId
								? {
										...board,
										swimlanes: [
											...board.swimlanes,
											{
												id: `pending-swimlane-${title}`,
												title,
												readonly: true,
												issues: [],
											},
										],
								  }
								: board,
						),
				  }
				: prev,
		);

		send('swimlane:create', {title, boardId});
	};

	const openRenameSwimlane = (swimlaneId: string) => {
		const swimlane = visibleSwimlanes.find(x => x.id === swimlaneId);
		if (!swimlane) return;

		setRenameSwimlane({swimlaneId, title: swimlane.title});
	};

	const submitRenameSwimlane = () => {
		if (!renameSwimlane) return;

		const {swimlaneId} = renameSwimlane;
		const title = renameSwimlane.title.trim();

		setRenameSwimlane(null);

		// An empty title is refused by the server, and blanking a column is never
		// what the reader meant by it, so treat it as a cancel.
		if (!title) return;

		setState(prev =>
			prev
				? updateSwimlaneInGuiState(prev, swimlaneId, swimlane => ({
						...swimlane,
						title,
				  }))
				: prev,
		);

		send('swimlane:edit:title', {swimlaneId, title});
	};

	// From the board rather than the filtered lanes, and resolved at render
	// rather than captured when the menu was clicked: the confirm counts what the
	// delete destroys, which a board filter must not be able to talk down.
	const deletingSwimlane =
		selectedBoard?.swimlanes.find(x => x.id === deleteSwimlaneId) ?? null;

	// A dead socket cannot carry a mutation, so the board wears the same
	// readonly it wears mid-scrub — every existing guard keys off this, so the
	// kebabs, the + buttons, dragging and the editors all stand down together.
	//
	// Only once a board has arrived: `connected` starts false, so keying off it
	// alone would dim and freeze every first paint until the socket opens.
	const offline = !connected && state !== null;

	const shownSwimlanes = useMemo(
		() =>
			offline
				? visibleSwimlanes.map(swimlane => ({
						...swimlane,
						readonly: true,
						issues: swimlane.issues.map(issue => ({...issue, readonly: true})),
				  }))
				: visibleSwimlanes,
		[offline, visibleSwimlanes],
	);

	// The dragged id comes off the drop event rather than being remembered from
	// dragstart: a drag can begin in one window and end in this one, and the
	// dataTransfer is the only thing that crosses.
	const dropSwimlane = (swimlaneId: string) => {
		const edge = swimlaneDropEdge;
		setSwimlaneDropEdge(null);

		if (!edge || !swimlaneId || !selectedBoard) return;

		const overIndex = visibleSwimlanes.findIndex(x => x.id === edge.swimlaneId);
		if (overIndex === -1) return;

		moveSwimlane(state, setState, send)(
			swimlaneId,
			selectedBoard.id,
			edge.side === 'left' ? overIndex : overIndex + 1,
		);
	};

	const confirmDeleteSwimlane = () => {
		if (!deleteSwimlaneId) return;

		setState(prev =>
			prev
				? updateSwimlaneInGuiState(prev, deleteSwimlaneId, () => null)
				: prev,
		);

		send('swimlane:delete', {swimlaneId: deleteSwimlaneId});
		setDeleteSwimlaneId(null);
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

	// Ahead of the board: without a project there are no boards, no history and
	// no scrubber to draw, so the shell would only frame an empty screen.
	if (noProject) {
		return (
			<InitProjectScreen
				repoRoot={noProject.repoRoot}
				message={noProject.message}
				onRetry={requestState}
			/>
		);
	}

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

			<Header
				state={state}
				connection={
					connected
						? 'connected'
						: !offline
						? 'connecting'
						: reconnectExhausted
						? 'lost'
						: 'reconnecting'
				}
				onReconnect={reconnectNow}
				scrubbing={state?.timeTravel?.mode === 'scrub'}
				syncStatus={syncStatus}
			/>

			<TimeScrubber
				timeline={history.timeline}
				commits={history.commits}
				historyId={history.requestId}
				boardId={selectedBoardId}
				connected={connected}
				socketEpoch={socketEpoch}
				onRequestHistory={requestBoardHistory}
				onInspectCommit={openCommitDiff}
				highlightEventId={hoveredLogEventId}
				timeTravel={state?.timeTravel ?? {mode: 'live', asOfTime: null}}
				onScrub={scrubToTime}
				onReturnToLive={returnToLive}
				onBoardFilterChange={setBoardFilter}
			/>

			{/* Dimmed while offline so the board reads as inert. The topbar stays at
			    full strength: it carries the reason and the way back. */}
			<div
				style={{
					display: 'flex',
					flex: 1,
					overflow: 'hidden',
					opacity: offline ? 0.55 : 1,
					transition: 'opacity 160ms ease',
				}}
			>
				{/* Vertical overflow is hidden here: the swimlanes size themselves to
				    this box, so anything spilling out would put a second scrollbar on
				    the page next to the columns' own. */}
				<main
					onClick={clearPicked}
					style={{
						padding: '0 0 0 30px',
						flex: 1,
						minHeight: 0,
						display: 'flex',
						flexDirection: 'column',
						overflow: 'hidden',
					}}
				>
					<div
						style={{
							padding: '20px 10px',
							display: 'flex',
							alignItems: 'center',
							gap: 10,
						}}
					>
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
						{shownSwimlanes.map(swimlane => (
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
								onRenameSwimlane={openRenameSwimlane}
								onDeleteSwimlane={setDeleteSwimlaneId}
								dropSide={
									swimlaneDropEdge?.swimlaneId === swimlane.id
										? swimlaneDropEdge.side
										: null
								}
								onSwimlaneDragOver={(swimlaneId, side) =>
									setSwimlaneDropEdge({swimlaneId, side})
								}
								onSwimlaneDragEnd={() => setSwimlaneDropEdge(null)}
								onDropSwimlane={dropSwimlane}
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

						{/* Appends: `createSwimlane` ranks at the end, so the ghost sits
							where the new column will actually appear. Hidden on a readonly
							board, which also covers a scrubbed timeline. */}
						{selectedBoard && !selectedBoard.readonly && !offline && (
							<AddSwimlaneColumn onClick={() => setCreateSwimlaneTitle('')} />
						)}

						{/* Grows scrollWidth by exactly what closing the panel gave back
							in clientWidth, keeping max scrollLeft identical across
							open/closed so the board doesn't bounce back when scrolled far
							right. Reads the panel's persisted width directly rather than
							tracking it live: the panel — and any drag — isn't mounted while
							this spacer is, so the last-persisted value is always current. */}
						{!commitDiff && !(selectedIssue && state?.user) && (
							<div style={{width: readStoredAsideWidth(), flexShrink: 0}} />
						)}

						{/* The page's right margin, scrolling with the columns. Constant,
							so it cancels out of the invariant above. */}
						<div style={{width: BOARD_GUTTER, flexShrink: 0}} />
					</div>
				</main>

				{commitDiff && (
					<Aside onWidthChange={setCommitDiffPanelWidth}>
						{({isFullscreen, toggleFullscreen}) => (
							<DiffPanel
								sha={commitDiff.sha}
								files={commitDiff.files}
								loading={commitDiff.loading}
								error={commitDiff.error}
								diffStyle={
									commitDiffPanelWidth >= STACKED_DIFF_WIDTH
										? 'split'
										: 'unified'
								}
								onClose={closeCommitDiff}
								isFullscreen={isFullscreen}
								toggleFullscreen={toggleFullscreen}
							/>
						)}
					</Aside>
				)}

				{!commitDiff && pickedIssues.length > 1 && (
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
							// Skips the ones already closed: the event log would otherwise
							// carry a second "Closed" for each of them.
							for (const issue of pickedIssues) {
								if (!issue.isClosed) closeIssue(issue.id);
							}
							clearPicked();
						}}
						onReopenIssues={() => {
							for (const issue of pickedIssues) {
								if (issue.isClosed) reopenIssue(issue.id);
							}
							clearPicked();
						}}
						onClear={clearPicked}
					/>
				)}

				{!commitDiff &&
					pickedIssues.length <= 1 &&
					selectedIssue &&
					state?.user && (
						<IssueDetails
							whoAmI={state.user}
							issue={((): GuiIssue => {
								const base =
									issueDetail?.issueId === selectedIssue.id
										? {...selectedIssue, description: issueDetail.description}
										: selectedIssue;

								return offline ? {...base, readonly: true} : base;
							})()}
							activeTab={selectedTab}
							comments={
								issueDetail?.issueId === selectedIssue.id
									? issueDetail.comments
									: []
							}
							history={
								issueDetail?.issueId === selectedIssue.id
									? issueDetail.history
									: []
							}
							onHoverHistoryEvent={setHoveredLogEventId}
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
							commits={
								issueCommits?.issueId === selectedIssue.id
									? issueCommits.commits
									: []
							}
							commitsLoading={
								issueCommits?.issueId === selectedIssue.id
									? issueCommits.loading
									: false
							}
							commitsError={
								issueCommits?.issueId === selectedIssue.id
									? issueCommits.error
									: null
							}
							commitDiffsBySha={issueCommitDiffs}
							onLoadCommitDiff={loadIssueCommitDiff}
							onReopenIssue={reopenIssue}
							onCloseIssue={closeIssue}
							knownTags={state.tags ?? []}
							knownAssignees={contributors}
							onOpenAssigneePicker={requestContributors}
						/>
					)}
			</div>

			{createIssueModal && (
				<CreateNodeModal
					eyebrow="New issue"
					fieldLabel="title"
					placeholder="issue name"
					title={createIssueModal.title}
					onChangeTitle={title =>
						setCreateIssueModal(prev => (prev ? {...prev, title} : prev))
					}
					onCreate={createIssue}
					onClose={() => setCreateIssueModal(null)}
				/>
			)}

			{renameSwimlane && (
				<CreateNodeModal
					eyebrow="Rename swimlane"
					fieldLabel="title"
					placeholder="swimlane name"
					confirmLabel="rename"
					title={renameSwimlane.title}
					onChangeTitle={title =>
						setRenameSwimlane(prev => (prev ? {...prev, title} : prev))
					}
					onCreate={submitRenameSwimlane}
					onClose={() => setRenameSwimlane(null)}
				/>
			)}

			{deletingSwimlane && (
				<ConfirmModal
					eyebrow="Delete swimlane"
					heading={`Delete "${deletingSwimlane.title}"?`}
					body={
						deletingSwimlane.issues.length > 0
							? `This also deletes the ${
									deletingSwimlane.issues.length
							  } ticket${
									deletingSwimlane.issues.length === 1 ? '' : 's'
							  } in it. Their history stays in the event log, but they leave the board.`
							: 'The swimlane is empty, so nothing else goes with it.'
					}
					confirmLabel="delete"
					onConfirm={confirmDeleteSwimlane}
					onClose={() => setDeleteSwimlaneId(null)}
				/>
			)}

			{createSwimlaneTitle !== null && (
				<CreateNodeModal
					eyebrow="New swimlane"
					fieldLabel="title"
					placeholder="swimlane name"
					title={createSwimlaneTitle}
					onChangeTitle={setCreateSwimlaneTitle}
					onCreate={createSwimlane}
					onClose={() => setCreateSwimlaneTitle(null)}
				/>
			)}
		</div>
	);
};
