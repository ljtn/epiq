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
import {
	InitProjectScreen,
	RecentProjectView,
} from './components/InitProjectScreen';
import {Dropdown} from './components/Dropdown';
import {Header} from './components/Header';
import {IssueDetails} from './components/IssueDetails';
import {
	FileTicketParams,
	formatSelectionLabel,
	clearDiffLocationParams,
	DiffLocation,
	readCommitFocusParam,
	encodeDiffCommentMarker,
	readDiffLocationParams,
	writeDiffLocationParams,
} from './components/IssueCommits';
import {BulkDetails} from './components/BulkDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {GlobalScrollbarStyles} from './components/GlobalScrollbarStyles';
import {TicketRefLinksProvider} from './components/MarkdownContent';
import {ErrorToast} from './components/ErrorToast';
import {TimeScrubber} from './components/TimeScrubber';
import {TheatrePlayer} from './components/TheatrePlayer';
import {EventLog} from './components/EventLog';
import {useAsideDock} from './lib/aside-dock';
import {moveIssue} from './lib/gui-move-issue';
import {moveSwimlane} from './lib/gui-move-swimlane';
import {DropTarget} from './lib/gui-result.model';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {issueMatchesText} from '../../lib/utils/text-match.js';
import {commitTicketRef} from '../../lib/utils/commit-ref.js';
import {
	findBoard,
	findIssue,
	getResultValue,
	updateIssueInGuiState,
	updateSwimlaneInGuiState,
} from './lib/gui-state-helper';
import {
	GuiCommitDiff,
	GuiCommitDiffFile,
	GuiIssue,
	GuiCommitEntry,
	GuiContributor,
	GuiEventTimeline,
	GuiState,
	GuiSwimlane,
	GuiUser,
} from './lib/gui-state.model';
import {
	buildBoardFilter,
	isPeriodWindow,
	issuePassesBoardFilter,
	usePersistedFlag,
	windowIssueIds,
} from './lib/scrubber';
import {
	buildTheatrePlan,
	THEATRE_PLAYER_CLEARANCE,
	TheatrePlan,
	useTheatrePlayback,
} from './lib/theatre';
import {useEventLog} from './lib/use-event-log';
import {Input} from './components/FormPrimitives';
import {useBoardSelection} from './lib/use-board-selection';
import {BoardSocketActions, useBoardSocket} from './lib/use-board-socket';
import {useIssueDetail} from './lib/use-issue-detail';
import {createHistoryBuffer} from './lib/history-buffer';
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

// How long the board has to be quiet before an open log asks for the window
// again. A state broadcast is not a rare thing — a needle drag makes one every
// 120ms and a bulk action one per ticket — and each refetch is a full replay of
// the event log plus a `git log`, so a burst has to cost one ask, not one each.
const LOG_REFRESH_QUIET_MS = 400;

// The ring around the text filter while it holds one. The accent at low alpha,
// so the field reads as lit rather than as selected.
const FILTER_ON_RING = 'rgba(118, 212, 255, 0.18)';

// Remembered beside the scrubber's own view flags, which is what their controls
// sit among. The two series live here rather than in the scrubber because the
// log is drawn from them and is not the scrubber's to draw.
const LOG_STORAGE_KEY = 'epiq.timeScrubber.showLog';
const SHOW_ISSUES_STORAGE_KEY = 'epiq.timeScrubber.showIssues';
const SHOW_COMMITS_STORAGE_KEY = 'epiq.timeScrubber.showCommits';

// What the chrome around the board wears while a movie plays. Faded rather than
// unmounted: the page must not reflow around the picture being watched.
const DIMMED_WHILE_PLAYING: React.CSSProperties = {
	opacity: 0.3,
	pointerEvents: 'none',
	transition: 'opacity 240ms ease',
};

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
	const [selection, changeSelection] = useBoardSelection();

	// The connection is opened here, before anything that sends on it, and is
	// handed a trampoline rather than the handler itself: the handler is written
	// further down, where the state it sets is declared, and everything between
	// the two still gets to use `send`.
	const socketMessageRef = useRef<
		(message: any, socket: BoardSocketActions) => void
	>(() => {});

	const {
		connected,
		socketEpoch,
		reconnectExhausted,
		reconnectNow,
		send,
		sendRaw,
		requestState,
	} = useBoardSocket({
		boardId,
		onMessage: (message, socket) => socketMessageRef.current(message, socket),
	});

	// Bumped per socket, not per connection state: a socket the effect replaces
	// never reports a disconnect, so `connected` alone cannot tell a reader that
	// its outstanding requests died with the old socket.
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
		recentProjects: RecentProjectView[];
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
	// The movie on screen, or null for no player. Held rather than derived from
	// the timeline: the window is re-fetched while the board changes underneath
	// it, and a plan that changed halfway would be a different film.
	const [theatre, setTheatre] = useState<TheatrePlan | null>(null);
	// Bumped per answered time-travel request. The player's clock waits on it
	// rather than stacking a checkout on one the server has not answered yet.
	const [scrubAck, setScrubAck] = useState(0);
	// The log panel is open. Owned here rather than in the scrubber or the
	// player: it is a panel in the board's own row, the board moves over for it,
	// and its checkbox and the player's pop-out are two controls over one flag.
	const [logOpen, setLogOpen] = usePersistedFlag(LOG_STORAGE_KEY, false);
	const [showIssues, setShowIssues] = usePersistedFlag(
		SHOW_ISSUES_STORAGE_KEY,
		true,
	);
	const [showCommits, setShowCommits] = usePersistedFlag(
		SHOW_COMMITS_STORAGE_KEY,
		true,
	);
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
	// Which edge every panel attaches to. Owned here rather than inside
	// `Aside`, because the row below turns into a column for a bottom dock and
	// a component cannot style its own parent.
	const [asideDock, setAsideDock] = useAsideDock();
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
	// Set right before an issues:create request that came from "File ticket"
	// on a diff selection, consumed by that request's own issues:create:result
	// reply — that's how the origin ticket's back-comment knows which creation
	// to react to.
	const pendingFileTicketOrigin = useRef<{
		originIssueId: string;
		originRef: string;
	} | null>(null);

	const tabParam = searchParams.get('tab');
	const selectedTab: IssueDetailsTab =
		tabParam === 'comments' || tabParam === 'history' || tabParam === 'code'
			? tabParam
			: 'overview';
	// Where a followed comment permalink points, if any. Read straight off the
	// URL so the deep link survives a reload rather than living in state.
	const diffFocus =
		readDiffLocationParams(searchParams) ?? readCommitFocusParam(searchParams);
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

	// Same reasoning as selectedBoardIdRef, for navigate: it is not guaranteed
	// referentially stable across renders, and having it in the socket effect's
	// deps meant every call to navigate() — including a same-board ticket
	// switch — tore the whole connection down and reopened it. Reading it from
	// a ref lets the effect drop that dependency and stay mounted across a
	// plain ticket switch.
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

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

	// The board's state carries no descriptions, comment bodies or commits —
	// they are most of a ticket's weight and nothing on the board draws them.
	// Fetched, and kept up to date, for the one ticket whose details are open.
	const {
		detail: issueDetail,
		commits: issueCommits,
		commitDiffs: issueCommitDiffs,
		loadCommitDiff: loadIssueCommitDiff,
		updateComments: updateDetailComments,
		onMessage: onIssueDetailMessage,
	} = useIssueDetail({
		issueId: selectedIssue?.id ?? null,
		boardState: state,
		// The board's own state is what a movie is showing; the panel is not
		// even on screen.
		paused: theatre !== null,
		sendRaw,
	});
	// Typed into the box beside the board switcher; hides cards whose ref and
	// title both miss it. Not part of the URL selection: it is a passing
	// narrowing, not a view worth linking to.
	const [textFilter, setTextFilter] = useState('');
	// Null unless the selection has been narrowed to particular tags or people.
	const boardFilter = useMemo(
		() => buildBoardFilter(selection.view, selection.only),
		[selection.view, selection.only],
	);

	const zoomed = selection.zoom !== null;

	// The tickets the scrubber's window has an event for, once the board has
	// been narrowed to them. Null while it has not, and where the window is one
	// the server answered with counts alone.
	//
	// The period test is the same one that greys the box: a narrowing left on
	// from a period the user has since left must not go on hiding tickets from
	// under a control that can no longer be pressed.
	const windowIds = useMemo(
		() =>
			selection.windowOnly && isPeriodWindow(selection.scope, zoomed)
				? windowIssueIds(history.timeline)
				: null,
		[selection.windowOnly, selection.scope, zoomed, history.timeline],
	);

	// The board narrows to the ticket as well as the chart, so its card can be
	// watched crossing the lanes on its own while the needle is dragged. Only
	// while one is actually open: the box can be left ticked by a link.
	const isolatedIssueId =
		selection.ticketOnly && selectedIssue ? selectedIssue.id : null;

	// The tag every card is narrowed to, if the selection is exactly one tag:
	// its chips read as pressed, and pressing again is the way back.
	const isolatedTagId =
		selection.view === 'tagging' && selection.only?.length === 1
			? selection.only[0] ?? null
			: null;

	const filterByTag = (tagId: string) =>
		changeSelection(
			isolatedTagId === tagId ? {only: null} : {view: 'tagging', only: [tagId]},
		);

	// For naming a selected identity the scrubber's window has no event for.
	const knownIdentities = useMemo(() => {
		const people = new Map<string, GuiUser>();
		for (const person of [...(state?.contributors ?? []), ...contributors]) {
			if (!people.has(person.id)) people.set(person.id, person);
		}
		const users = [...people.values()];

		return {tag: state?.tags ?? [], actor: users, assignee: users};
	}, [state?.tags, state?.contributors, contributors]);

	// Memoized, and returning the lanes untouched when nothing is filtered:
	// rebuilding every swimlane object each render would hand SwimlaneColumn a
	// new identity every time and undo its memoization.
	const {visibleSwimlanes, hiddenIssueCount} = useMemo(() => {
		const swimlanes = selectedBoard?.swimlanes ?? [];
		const query = textFilter.trim();
		if (!boardFilter && !query && windowIds === null && !isolatedIssueId)
			return {visibleSwimlanes: swimlanes, hiddenIssueCount: 0};

		let hidden = 0;

		const visible = swimlanes.map(swimlane => {
			const issues = swimlane.issues.filter(
				issue =>
					issuePassesBoardFilter(
						issue,
						(commentsByIssueId[issue.id] ?? []).map(
							comment => comment.author.id,
						),
						boardFilter,
					) &&
					issueMatchesText(issue, query) &&
					(windowIds === null || windowIds.has(issue.id)) &&
					(!isolatedIssueId || issue.id === isolatedIssueId),
			);

			hidden += swimlane.issues.length - issues.length;

			return {...swimlane, issues};
		});

		return {visibleSwimlanes: visible, hiddenIssueCount: hidden};
	}, [
		selectedBoard,
		boardFilter,
		textFilter,
		commentsByIssueId,
		windowIds,
		isolatedIssueId,
	]);
	const attachmentsByIssueId = state?.attachmentsByIssueId ?? {};
	const [attachmentUploadStatus, setAttachmentUploadStatus] =
		useState<AttachmentUploadStatus>({state: 'idle'});

	// Every frame the board's connection delivers, and what it means. The
	// connection itself — opening, losing, retrying, sending — is
	// `useBoardSocket`'s; this is only the reading of what arrives on it.
	const onSocketMessage = (message: any, socket: BoardSocketActions) => {
		// Not exclusive: `commit:diff:result` is also read below, for the diff the
		// scrubber's own commit dot opens.
		onIssueDetailMessage(message);

		if (message.type === 'state' && !socket.holdsState()) {
			const nextState = getResultValue<GuiState>(message.payload);
			if (nextState) {
				setState(nextState);
				setNoProject(null);
			}
		}

		if (message.type === 'state:unavailable') {
			setNoProject(message.payload);
		}

		if (message.type === 'project:open:result') {
			const result = message.payload as {status: string; message: string};

			if (result.status !== 'success') {
				setNoProject(current =>
					current ? {...current, message: result.message} : current,
				);
			}
		}

		// Keyed off this request's own reply, never a broadcast: a broadcast
		// fires for every creation on the board, including other people's,
		// and navigating on one yanked every connected client to whichever
		// ticket happened to be created next.
		if (message.type === 'issues:create:result') {
			const origin = pendingFileTicketOrigin.current;
			pendingFileTicketOrigin.current = null;

			const created = getResultValue<{id: string}>(message.payload);

			if (created && boardId) {
				void navigateRef.current(
					`/board/${boardId}/issue/${nodeRef(created.id)}?tab=overview`,
				);
			}

			if (origin && created) {
				socket.sendRaw({
					type: 'issue:comment:add',
					payload: {
						issueId: origin.originIssueId,
						body: `Filed \`${nodeRef(
							created.id,
						)}\` from a code selection on this ticket.`,
					},
				});
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
			socket.requestState();
		}

		// A frame the server could not parse is refused the same way, and
		// was otherwise invisible — the optimistic change just quietly held.
		if (message.type === 'error') {
			setActionError(
				typeof message.message === 'string'
					? message.message
					: 'The board could not read that change',
			);
			socket.requestState();
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
			socket.sendRaw({
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

		if (
			message.type === 'tag:remove:result' &&
			message.payload?.status === 'fail'
		) {
			setRemoveError(`Couldn't delete a tag: ${message.payload.message}`);
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
			} else {
				const diff = getResultValue<GuiCommitDiff>(result);
				if (diff) {
					setCommitDiff(prev =>
						prev && prev.sha === diff.sha
							? {...prev, loading: false, error: null, files: diff.files}
							: prev,
					);
				}
			}
		}

		if (message.type === 'time-travel:result') {
			// Every reply, refusals included: the player's clock is waiting on
			// one, and a refused checkout it never heard about would stall it.
			setScrubAck(count => count + 1);

			if (message.payload?.status === 'fail') {
				console.log('Time travel failed', message);
				socket.requestState();
			}
		}

		if (message.type === 'sync-status') {
			setSyncStatus(message.payload);
		}
	};

	socketMessageRef.current = onSocketMessage;

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

		// The ticket panel renders only while no commit diff does, so a diff left
		// open by an earlier dot click would hide the ticket just asked for.
		setCommitDiff(null);

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

	// Every ref that resolves to a real ticket, across every board — a ref
	// mentioned in one ticket's comments routinely belongs to another. Only
	// these are linkified: a ref's 7-character shape is indistinguishable from
	// an ordinary uppercase word, so resolving is what makes it safe.
	const knownTicketRefs = useMemo(
		() =>
			new Set(
				(state?.boards ?? []).flatMap(board =>
					board.swimlanes.flatMap(swimlane =>
						swimlane.issues.map(issue => issue.ref),
					),
				),
			),
		[state],
	);

	const ticketRefLinks = useMemo(
		() => ({
			isKnownRef: (ref: string) => knownTicketRefs.has(ref),
			// findIssue resolves a ref across every board, so opening by ref works
			// even when the ticket lives on one the reader isn't looking at.
			onOpen: (ref: string) => {
				if (boardSlug) void navigate(`/board/${boardSlug}/issue/${ref}`);
			},
		}),
		[knownTicketRefs, boardSlug, navigate],
	);

	const selectIssueComments = (nextIssueId: string) => {
		if (!boardSlug) return;

		setCommitDiff(null);

		void navigate(
			`/board/${boardSlug}/issue/${nodeRef(nextIssueId)}?tab=comments`,
		);
	};

	const changeIssueDetailsTab = (nextTab: IssueDetailsTab) => {
		setSearchParams(
			prev => {
				const next = new URLSearchParams(prev);
				next.set('tab', nextTab);
				// A deep link belongs to the Commits tab it points into; leaving it
				// on the URL after a deliberate tab change would drag the reader
				// back to it the moment they returned.
				clearDiffLocationParams(next);
				return next;
			},
			{replace: true},
		);
	};

	// Following a comment's file/line reference: the location goes in the URL
	// rather than into state, so the resulting view survives a reload and can
	// be handed to someone else. Pushed, not replaced — this is a navigation
	// the reader should be able to come back from.
	const openDiffLocation = (location: DiffLocation) => {
		// Another ticket's diff: go to that ticket's Commits tab at the spot.
		if (location.issueRef && location.issueRef !== selectedIssue?.ref) {
			if (!boardSlug) return;
			const params = new URLSearchParams({tab: 'code'});
			writeDiffLocationParams(params, location);
			void navigate(`/board/${boardSlug}/issue/${location.issueRef}?${params}`);
			return;
		}

		setSearchParams(prev => {
			const next = new URLSearchParams(prev);
			next.set('tab', 'code');
			writeDiffLocationParams(next, location);
			return next;
		});
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

	// Hides the tag everywhere; the id and every ticket reference survive. The
	// state broadcast that follows drops it from every card at once.
	const removeTag = (tagId: string) => {
		send('tag:remove', {tagId});
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

	// Checks the board out at the moment one Log row stands for. The event is
	// named rather than timed: the server resolves the cut, so a row's displayed
	// timestamp never has to agree with the log's own ordering.
	const checkoutHistoryEvent = (eventId: string) => {
		send('time-travel:checkout-event', {eventId});
	};

	const returnToLive = () => {
		send('time-travel:live', {});
	};

	// Plays the window the scrubber is showing. Its own timeline is the script:
	// the same events it has drawn, in the order the clock put them in.
	const startTheatre = () => {
		if (!history.timeline) return;

		setTheatre(buildTheatrePlan(history.timeline));
	};

	// Leaving the cinema hands the board back, live and editable, wherever the
	// movie happened to stop.
	const exitTheatre = () => {
		setTheatre(null);
		returnToLive();
	};

	const playback = useTheatrePlayback({
		plan: theatre,
		ack: scrubAck,
		onSeek: scrubToTime,
	});

	// Bumped when the board has changed in a way that means the scrubber's window
	// has to be asked for again. A number rather than the state itself, because
	// the scrubber re-fetches on this value *changing*: handing it null while a
	// movie plays would itself be a change, and would fetch a window anchored to
	// now — later than the one the movie was planned from, so the log would lose
	// the very lines the playhead is narrating.
	const [historyTick, setHistoryTick] = useState(0);

	useEffect(() => {
		// The plan is drawn from the window, so nothing may move it mid-movie.
		if (theatre) return;

		const bump = () => setHistoryTick(tick => tick + 1);

		// The narrowing hides tickets, so it cannot wait: a ticket filed a moment
		// ago would be missing from the board it has just joined.
		if (selection.windowOnly) {
			bump();
			return;
		}

		if (!logOpen) return;

		const timer = window.setTimeout(bump, LOG_REFRESH_QUIET_MS);
		return () => window.clearTimeout(timer);
	}, [state, theatre, selection.windowOnly, logOpen]);

	const logEntries = useEventLog({
		open: logOpen,
		timeline: history.timeline,
		commits: history.commits,
		selection,
		selectedIssueId: selectedIssue?.id ?? null,
		showIssues,
		showCommits,
		playing: theatre !== null,
		playheadTime: playback.current?.t ?? null,
		timeTravel: state?.timeTravel,
	});

	// A movie is checked out one frame at a time over the socket, so a dropped
	// one leaves the player running against nothing. It closes rather than
	// stalling; the board is already parked wherever the last frame landed, and
	// the reconnect brings the way back with it.
	useEffect(() => {
		if (!connected) setTheatre(null);
	}, [connected]);

	// Both requests carry the same id so their replies can be paired, and replies
	// to an abandoned request discarded.
	// Returns the id the reply will carry, so the caller can tell its own
	// window's answer from one still arriving for a window it has left.
	const requestBoardHistory = useCallback(
		(start?: number, end?: number, allBoards?: boolean): number => {
			const window = start !== undefined ? {start, end} : undefined;

			const requestId = historyBuffer.open();
			// The board scopes the timeline but not the commit log, which is
			// repository-wide. Omitting boardId is how the API says "every board"
			// — which is also the right ask before any board is known, and the
			// only one the schema accepts (null is refused).
			sendRaw({
				type: 'timeline:get',
				payload: {
					...window,
					boardId: allBoards ? undefined : selectedBoardId ?? undefined,
					requestId,
				},
			});
			sendRaw({
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
		sendRaw({
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

	// A commit that links to a ticket is read on that ticket's Commits tab,
	// next to its comments and the rest of its commits; only one that links
	// nowhere gets the bare panel.
	const openCommitDiff = useCallback(
		(sha: string) => {
			const subject =
				history.commits.find(commit => commit.sha === sha)?.subject ?? '';
			const ref = commitTicketRef(subject, knownTicketRefs);

			if (ref && boardSlug) {
				// A bare panel left open by an earlier unlinked commit would sit in
				// front of the ticket this one opens, still showing that older diff.
				setCommitDiff(null);
				void navigate(
					`/board/${boardSlug}/issue/${ref}?tab=code&commit=${sha}`,
				);
				return;
			}

			setCommitDiff({sha, loading: true, error: null, files: null});
			sendRaw({
				type: 'commit:diff:get',
				payload: {sha},
			});
		},
		[history.commits, knownTicketRefs, boardSlug, navigate],
	);

	const closeCommitDiff = useCallback(() => setCommitDiff(null), []);

	// A diff belongs to the view it was opened over, and the ticket panel
	// renders only while no diff does — so one left up hides whatever the next
	// route lands on. Cleared here rather than at each call site: a ticket is
	// also reached by creating one, by a ref link, and by a comment permalink,
	// and each of those had to remember on its own. Selecting the ticket
	// already open is the one case this cannot see, and selectIssue clears it.
	useEffect(() => {
		setCommitDiff(null);
	}, [boardId, issueId]);

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

	const fileTicketFromSelection = (
		originIssueId: string,
		originRef: string,
		params: FileTicketParams,
	) => {
		// The leftmost swimlane, by the board's own left-to-right "not started →
		// done" convention — a ticket filed off a code review is new work, so it
		// belongs there rather than beside the ticket being reviewed.
		const targetSwimlaneId = selectedBoard?.swimlanes[0]?.id;
		if (!targetSwimlaneId) return;

		// Same shape as a diff comment's body, so the Overview renders it the
		// same way — note, then the snippet headed by a link that opens the
		// origin ticket's diff at the selection.
		const side = params.range.side ?? 'additions';
		const description = [
			...(params.note ? [params.note, ''] : []),
			`Filed from a code selection on \`${originRef}\`.`,
			'',
			encodeDiffCommentMarker({
				filePath: params.filePath,
				start: params.range.start,
				side,
				end: params.range.end,
				endSide: params.range.endSide ?? side,
				note: params.note,
				sha: params.sha,
				issueRef: originRef,
			}),
			`\`${params.filePath}\` ${formatSelectionLabel(params.range)}`,
			'```',
			params.snippet,
			'```',
		].join('\n');

		pendingFileTicketOrigin.current = {originIssueId, originRef};

		send('issues:create', {
			title: params.title,
			parentId: targetSwimlaneId,
			description,
			tagNames: ['from-code-comment'],
		});
	};

	// Returns one markdown reference per file that made it, so a composer can
	// leave them at the cursor. A rejected file contributes nothing and the
	// error is reported through attachmentUploadStatus as before.
	const uploadIssueAttachments = async (
		issueId: string,
		files: File[],
	): Promise<string[]> => {
		const inserted: string[] = [];

		for (const file of files) {
			setAttachmentUploadStatus({state: 'uploading', name: file.name});

			const compressed = await compressImage(file, state?.attachmentMaxKb);

			if ('error' in compressed) {
				setAttachmentUploadStatus({state: 'error', message: compressed.error});
				return inserted;
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
					return inserted;
				}

				const nextState = getResultValue<GuiState>(payload);
				if (nextState) setState(nextState);

				const markdown = (payload as {attachment?: {markdown?: string}})
					?.attachment?.markdown;
				if (markdown) inserted.push(markdown);
			} catch (error) {
				setAttachmentUploadStatus({
					state: 'error',
					message: error instanceof Error ? error.message : 'Upload failed',
				});
				return inserted;
			}
		}

		setAttachmentUploadStatus({state: 'idle'});

		return inserted;
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

	const deleteIssueComment = (issueId: string, commentId: string) => {
		updateDetailComments(issueId, comments =>
			comments.filter(comment => comment.id !== commentId),
		);

		send('issue:comment:delete', {issueId, commentId});
	};

	const editIssueComment = (
		issueId: string,
		commentId: string,
		body: string,
	) => {
		updateDetailComments(issueId, comments =>
			comments.map(comment =>
				comment.id === commentId ? {...comment, body} : comment,
			),
		);

		send('issue:comment:edit', {issueId, commentId, body});
	};

	// Ahead of the board: without a project there are no boards, no history and
	// no scrubber to draw, so the shell would only frame an empty screen.
	if (noProject) {
		return (
			<InitProjectScreen
				repoRoot={noProject.repoRoot}
				message={noProject.message}
				recentProjects={noProject.recentProjects}
				onRetry={requestState}
				onOpen={root => send('project:open', {root})}
			/>
		);
	}

	return (
		<TicketRefLinksProvider value={ticketRefLinks}>
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

				{/* Dimmed and inert with the rest of the chrome while a movie plays:
				    the board is the picture, and everything around it is the room
				    lights. */}
				<div style={theatre ? DIMMED_WHILE_PLAYING : undefined}>
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
				</div>

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
					onPlayTheatre={startTheatre}
					theatreOpen={theatre !== null}
					logOpen={logOpen}
					onChangeLogOpen={setLogOpen}
					showIssues={showIssues}
					onChangeShowIssues={setShowIssues}
					showCommits={showCommits}
					onChangeShowCommits={setShowCommits}
					selection={selection}
					onChangeSelection={changeSelection}
					selectedIssue={
						selectedIssue
							? {id: selectedIssue.id, createdAt: selectedIssue.createdAt}
							: null
					}
					knownIdentities={knownIdentities}
					refreshOn={historyTick}
				/>

				{/* Dimmed while offline so the board reads as inert. The topbar stays at
			    full strength: it carries the reason and the way back. */}
				<div
					style={{
						display: 'flex',
						flexDirection: asideDock === 'bottom' ? 'column' : 'row',
						flex: 1,
						overflow: 'hidden',
						// A fullscreen panel is positioned against this row.
						position: 'relative',
						opacity: offline ? 0.55 : 1,
						transition: 'opacity 160ms ease',
					}}
				>
					{/* The log and the board are their own row inside this one, which
					    turns into a column for a bottom-docked panel. Without it the
					    log would stack above the board rather than beside it, as a
					    band the crawl has no height to run in. With no log open this
					    is one flex child holding another, which lays out exactly as
					    the board did on its own. */}
					<div
						style={{
							display: 'flex',
							flex: 1,
							minWidth: 0,
							minHeight: 0,
							overflow: 'hidden',
						}}
					>
						{logOpen && (
							<EventLog
								entries={logEntries}
								bottomClearance={theatre ? THEATRE_PLAYER_CLEARANCE : 0}
							/>
						)}

						{/* Vertical overflow is hidden here: the swimlanes size themselves to
				    this box, so anything spilling out would put a second scrollbar on
				    the page next to the columns' own. */}
						<main
							onClick={clearPicked}
							style={{
								padding: '0 0 0 30px',
								flex: 1,
								// Beside the log it has to be able to give up the width the
								// panel takes; a flex item's default floor is its content.
								minWidth: 0,
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
									...(theatre ? DIMMED_WHILE_PLAYING : {}),
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

								<Input
									data-testid="text-filter"
									type="search"
									value={textFilter}
									placeholder="filter by ref or title"
									aria-label="Filter tickets by ref or title"
									spellCheck={false}
									onChange={event => setTextFilter(event.target.value)}
									onKeyDown={event => {
										if (event.key === 'Escape') {
											setTextFilter('');
											event.currentTarget.blur();
										}
									}}
									style={{
										width: 220,
										padding: '5px 10px',
										fontSize: 12,
										// Lit while it holds one: it is the only one of the board's
										// narrowings with nothing else to say it is on, so a word
										// typed a while ago reads as a board missing its tickets.
										border: `1px solid ${
											textFilter.trim() ? GUI_THEME.accent : GUI_THEME.line
										}`,
										boxShadow: textFilter.trim()
											? `0 0 0 2px ${FILTER_ON_RING}`
											: undefined,
									}}
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
									// Lit, but not touchable: the board is what a movie is
									// watched on, and the panel a click would open is closed for
									// the duration anyway.
									pointerEvents: theatre ? 'none' : undefined,
									// The player floats over the board, and a column running
									// under it would play its last cards behind the transport.
									// Reserved rather than overlaid, so the whole picture stays
									// in view.
									paddingBottom: theatre ? THEATRE_PLAYER_CLEARANCE : 0,
									transition: 'padding-bottom 240ms ease',
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
										isolatedTagId={isolatedTagId}
										onFilterByTag={filterByTag}
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
										theatre={
											theatre
												? {
														flashIssueId: playback.current?.issue ?? null,
														flashKey: playback.current?.id ?? null,
												  }
												: null
										}
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
									<AddSwimlaneColumn
										onClick={() => setCreateSwimlaneTitle('')}
									/>
								)}

								{/* Grows scrollWidth by exactly what closing the panel gave back
							in clientWidth, keeping max scrollLeft identical across
							open/closed so the board doesn't bounce back when scrolled far
							right. Reads the panel's persisted width directly rather than
							tracking it live: the panel — and any drag — isn't mounted while
							this spacer is, so the last-persisted value is always current.
							Only for a side dock: a bottom panel takes height, not width, so
							reserving width for it would shove the board the other way.

							A film closes every one of those panels, so the width has to be
							reserved for that too — or pressing play over a board scrolled
							hard right bounces it back by the panel's width. */}
								{asideDock === 'right' &&
									(theatre ||
										(!commitDiff && !(selectedIssue && state?.user))) && (
										<div
											style={{width: readStoredAsideWidth(), flexShrink: 0}}
										/>
									)}

								{/* The page's right margin, scrolling with the columns. Constant,
							so it cancels out of the invariant above. */}
								<div style={{width: BOARD_GUTTER, flexShrink: 0}} />
							</div>
						</main>
					</div>

					{/* The side panels close for the film rather than dimming: at
					    440px they are a third of the picture, and none of what they
					    show is part of it. Closing is only visual — the ticket stays
					    selected, and the panel is back when the player leaves. */}
					{!theatre && commitDiff && (
						<Aside dock={asideDock} onWidthChange={setCommitDiffPanelWidth}>
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
									dock={asideDock}
									onDock={setAsideDock}
								/>
							)}
						</Aside>
					)}

					{!theatre && !commitDiff && pickedIssues.length > 1 && (
						<BulkDetails
							dock={asideDock}
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

					{!theatre &&
						!commitDiff &&
						pickedIssues.length <= 1 &&
						selectedIssue &&
						state?.user && (
							<IssueDetails
								dock={asideDock}
								onDock={setAsideDock}
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
								onCheckoutHistoryEvent={
									connected ? checkoutHistoryEvent : undefined
								}
								onChangeTab={changeIssueDetailsTab}
								onClose={closeIssueDetails}
								onEditTitle={editIssueTitle}
								onEditDescription={editIssueDescription}
								onAddTag={addIssueTag}
								onRemoveTag={removeIssueTag}
								onAddAssignee={addIssueAssignee}
								onAddExternalAssignee={addExternalIssueAssignee}
								onRemoveContributor={removeContributor}
								onDeleteTag={removeTag}
								onRemoveAssignee={removeIssueAssignee}
								onAddComment={addIssueComment}
								onDeleteComment={deleteIssueComment}
								onEditComment={editIssueComment}
								onFileTicket={fileTicketFromSelection}
								onOpenDiffLocation={openDiffLocation}
								diffFocus={diffFocus}
								attachments={attachmentsByIssueId[selectedIssue.id] ?? []}
								attachmentUploadStatus={attachmentUploadStatus}
								onUploadAttachments={uploadIssueAttachments}
								onDeleteAttachment={deleteIssueAttachment}
								commits={
									issueCommits?.issueId === selectedIssue.id
										? issueCommits.commits
										: []
								}
								// No entry for this ticket yet means its fetch is about to be
								// sent, not that it has nothing.
								commitsLoading={
									issueCommits?.issueId === selectedIssue.id
										? issueCommits.loading
										: true
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

				{theatre && (
					<TheatrePlayer
						plan={theatre}
						playback={playback}
						logOpen={logOpen}
						onToggleLog={() => setLogOpen(!logOpen)}
						onExit={exitTheatre}
					/>
				)}

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
		</TicketRefLinksProvider>
	);
};
