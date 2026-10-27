import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	matchPath,
	useBlocker,
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
import {discardTicketDrafts, hasTicketDrafts} from './lib/ticket-drafts';
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
	clearDiffLocationParams,
	clearDiffViewParam,
	DiffLocation,
	DiffViewName,
	readCommitFocusParam,
	readDiffLocationParams,
	readDiffViewParam,
	writeDiffLocationParams,
	writeDiffViewParam,
	writeFileFocusParams,
} from './lib/diff-selection';
import {
	formatSelectionLabel,
	encodeDiffCommentMarker,
} from '../../lib/utils/diff-comment.js';
import {BulkDetails} from './components/BulkDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {
	SwimlaneDetails,
	SwimlaneDetailsTab,
} from './components/SwimlaneDetails';
import {GlobalStyles} from './components/GlobalStyles';
import {TicketPreviewLayer} from './components/TicketPreviewLayer';
import {TooltipLayer} from './components/TooltipLayer';
import {TicketRefLinksProvider} from './components/MarkdownContent';
import {ErrorToast} from './components/ErrorToast';
import {TimeScrubber} from './components/TimeScrubber';
import {TheatrePlayer} from './components/TheatrePlayer';
import {EventLog} from './components/EventLog';
import {FollowBanner} from './components/FollowBanner';
import {useAsideDock} from './lib/aside-dock';
import {CommandPalette} from './components/CommandPalette';
import {buildCommandRegistry} from './lib/commands/command-registry';
import {useRecentCommands} from './lib/commands/command-recents';
import {useCommandPalette} from './lib/use-command-palette';
import {moveIssue} from './lib/gui-move-issue';
import {moveSwimlane} from './lib/gui-move-swimlane';
import {DropTarget} from './lib/gui-result.model';
import {deriveBoardStats} from '../../lib/stats/board-stats.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {issueMatchesText} from '../../lib/utils/text-match.js';
import {commitTicketRefs} from '../../lib/utils/commit-ref.js';
import {
	findBoard,
	findIssue,
	getResultValue,
	scrubCut,
} from './lib/gui-state-helper';
import {
	GuiCommitDiff,
	GuiCommitDiffFile,
	GuiIssue,
	GuiCommitEntry,
	GuiContributor,
	GuiEventIdentity,
	GuiEventTimeline,
	GuiRefCommitEntry,
	GuiState,
	GuiSwimlane,
	GuiUser,
} from './lib/gui-state.model';
import {
	actorIdsByIssue,
	buildBoardFilter,
	narrowedIds,
	FilterAxis,
	isPeriodWindow,
	issuePassesBoardFilter,
	windowIssueIds,
	windowNamesIssues,
} from './lib/scrubber';
import {usePersistedFlag} from './lib/use-persisted-flag';
import {
	CardDensityContext,
	useCardDensity,
	useCardDensityView,
} from './lib/card-density';
import {
	buildTheatrePlan,
	THEATRE_PLAYER_CLEARANCE,
	TheatrePlan,
	useTheatrePlayback,
} from './lib/theatre';
import {issueIdByRefFor} from './lib/commit-link';
import {useEventLog} from './lib/use-event-log';
import {useFollowedLine} from './lib/use-followed-line';
import {useFollowLog} from './lib/use-follow-log';
import {useLogWindow} from './lib/log-window';
import {LogDestination} from './lib/log-destination';
import {isolateOnly, withNarrowing} from './lib/board-selection';
import {useBoardSelection} from './lib/use-board-selection';
import {
	answersBoardOnScreen,
	BoardSocketActions,
	useBoardSocket,
} from './lib/use-board-socket';
import {useIssueDetail} from './lib/use-issue-detail';
import {useRefDiffStats} from './lib/use-ref-diff-stats';
import {useNeedleUrl} from './lib/needle-url';
import {GoalDetails, GoalDetailsTab} from './components/GoalDetails';
import {GoalStrip} from './components/GoalStrip';
import {ManageGoalsModal} from './components/ManageGoalsModal';
import {useTicketPreviews} from './lib/use-ticket-previews';
import {useSwimlaneStats} from './lib/use-swimlane-stats';
import {goalCodeSignature, useGoalAnswer} from './lib/use-goal-code';
import {IssueStats as IssueStatsValue} from '../../lib/stats/issue-stats.model.js';
import {useBoardOverview} from './lib/use-board-overview';
import {useContributorEmails} from './lib/use-contributor-emails';
import {usePersonalStats} from './lib/use-personal-stats';
import {useSyncSettings} from './lib/use-sync-settings';
import {useUpdateInfo} from './lib/use-update-info';
import {useRepos} from './lib/use-repos';
import {RepoLabelsContext} from './lib/use-repo-label';
import {useCommitRepoFilter} from './lib/commit-repo-filter';
import {ReposSettings} from './components/ReposSettings';
import {SettingsFocus, SettingsPanel} from './components/SettingsPanel';
import {IdentitySettings} from './components/IdentitySettings';
import {actorDisplay} from './lib/agent-identity';
import {IdentityAddresses} from './components/IdentityPanel';
import {IdentityStats} from './components/IdentityStats';
import {useIssueMutations} from './lib/use-issue-mutations';
import {useDescriptionEditing} from './lib/use-description-editing';
import {BoardDetails} from './components/BoardDetails';
import {IconLaneStats} from './components/IconLaneStats';
import {ICON_SIZE} from './components/IconButton';
import {useBoardEditing} from './lib/use-board-editing';
import {useSwimlaneEditing} from './lib/use-swimlane-editing';
import {createHistoryBuffer} from './lib/history-buffer';
import {SyncStatus} from './lib/gui-sync-statusmodel';
import {GUI_THEME, MONO_FONT} from './lib/gui-theme';
import {issueActivityLogEntries} from './lib/event-log';
import {plural} from './lib/gui-format.helper';
import {REVEAL_MS, useReveal} from './lib/use-reveal';
import {usePrefersReducedMotion} from './lib/scrubber';

type IssueDetailsTab = 'overview' | 'comments' | 'code' | 'stats';

// Module scope so an absent state does not hand the memos below a new object
// on every render.
const EMPTY_COMMENTS: GuiState['commentsByIssueId'] = {};

// The board's page margin, shared by <main>'s padding and the row's end spacer.
const BOARD_GUTTER = 4;

// A settings card's count, beside a title that already says what is counted.
const countOrNone = (count: number) => (count === 0 ? 'None' : String(count));

// Quiet time before an open log refetches its window: each refetch replays the
// whole log, and a needle drag broadcasts every 120ms.
const LOG_REFRESH_QUIET_MS = 400;

// Stored beside the scrubber's view flags; the series live here because the log draws from them.
const LOG_STORAGE_KEY = 'epiq.timeScrubber.showLog';
const SHOW_ISSUES_STORAGE_KEY = 'epiq.timeScrubber.showIssues';
const SHOW_COMMITS_STORAGE_KEY = 'epiq.timeScrubber.showCommits';
const COMPACTED_DIFF_STORAGE_KEY = 'epiq.diffTab.compacted';
const LINKED_COMMITS_STORAGE_KEY = 'epiq.timeScrubber.linkedCommitsOnly';

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
			margin: useCardDensityView().metrics.dropMargin,
			boxShadow: `0 0 12px ${GUI_THEME.accent}`,
		}}
	/>
);

const ticketInPath = (pathname: string) =>
	(
		matchPath('/board/:boardId/issue/:issueId', pathname) ??
		matchPath('/board/:boardId/:issueId', pathname)
	)?.params.issueId;

export const App = () => {
	const {boardId} = useParams<{boardId: string}>();

	// Read off the path: one route element serves every board path, so a ticket switch never remounts the board.
	const issueMatch = useMatch('/board/:boardId/issue/:issueId');
	// Legacy form without the /issue/ segment, so old links keep working.
	const legacyIssueMatch = useMatch('/board/:boardId/:issueId');
	const issueId =
		issueMatch?.params.issueId ?? legacyIssueMatch?.params.issueId;

	const [searchParams, setSearchParams] = useSearchParams();
	const [selection, changeSelection] = useBoardSelection();

	// Opened before anything sends on it; the trampoline reaches the handler declared further down.
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
		onMessage: (message, socket) => socketMessageRef.current(message, socket),
	});

	const [syncStatus, setSyncStatus] = useState<SyncStatus>({
		status: 'synced',
		msg: 'idle',
	});
	const [state, setState] = useState<GuiState | null>(null);
	// The server found no project; `state === null` only means no broadcast yet.
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
	// The movie on screen, or null. Held, not derived: the timeline is refetched while it plays.
	const [theatre, setTheatre] = useState<TheatrePlan | null>(null);
	// Bumped per answered time-travel request. The player's clock waits on it
	// rather than stacking a checkout on one the server has not answered yet.
	const [scrubAck, setScrubAck] = useState(0);
	// The log panel is open. Owned here rather than in the scrubber: it is a
	// panel in the board's own row, and the board moves over for it.
	const [logOpen, setLogOpen] = usePersistedFlag(LOG_STORAGE_KEY, false);
	const cardDensity = useCardDensity();
	// Held on screen for the length of its closing move, so the pane slides out
	// beside the board rather than being taken off it.
	const logReveal = useReveal(
		logOpen,
		usePrefersReducedMotion() ? 0 : REVEAL_MS,
	);
	const [showIssues, setShowIssues] = usePersistedFlag(
		SHOW_ISSUES_STORAGE_KEY,
		true,
	);
	const [showCommits, setShowCommits] = usePersistedFlag(
		SHOW_COMMITS_STORAGE_KEY,
		true,
	);
	// Off by default: a new board has no tickets to link commits to.
	const [linkedCommitsOnly, setLinkedCommitsOnly] = usePersistedFlag(
		LINKED_COMMITS_STORAGE_KEY,
		false,
	);
	const [commitDiff, setCommitDiff] = useState<{
		sha: string;
		loading: boolean;
		error: string | null;
		files: GuiCommitDiffFile[] | null;
		body?: string;
	} | null>(null);
	// The Aside's live width, for DiffPanel's split vs. unified choice; seeded from its persisted value.
	const [commitDiffPanelWidth, setCommitDiffPanelWidth] =
		useState(readStoredAsideWidth);
	// Owned here: a bottom dock turns the row below into a column.
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
	// Lifted here: the Log is in the details pane and its scatter above the board.
	const [hoveredLogEventId, setHoveredLogEventId] = useState<string | null>(
		null,
	);
	// An edge, not an index, so each column draws its own drop line.
	const [swimlaneDropEdge, setSwimlaneDropEdge] = useState<{
		swimlaneId: string;
		side: 'left' | 'right';
	} | null>(null);

	const boardMenuRef = useRef<HTMLDivElement | null>(null);
	// Set before an issues:create from "File ticket" on a diff, consumed by its own reply.
	const pendingFileTicketOrigin = useRef<{
		originIssueId: string;
		originRef: string;
	} | null>(null);

	// The board a creation was asked from, kept until its reply: one socket
	// outlives a board switch. Written only by `createIssueOn`.
	const pendingCreateBoard = useRef<string | undefined>(undefined);

	const tabParam = searchParams.get('tab');
	const selectedTab: IssueDetailsTab =
		tabParam === 'comments' || tabParam === 'code' || tabParam === 'stats'
			? tabParam
			: 'overview';
	// The comment a link points at, scrolled to and marked; off the URL so it survives a reload.
	const focusedCommentId = searchParams.get('comment');
	// Where a followed comment permalink points, if any. Read straight off the
	// URL so the deep link survives a reload rather than living in state.
	const diffFocus =
		readDiffLocationParams(searchParams) ?? readCommitFocusParam(searchParams);
	const navigate = useNavigate();

	// Route params carry shorthand refs. `boards` may be missing before a project exists.
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

	// A ref, so the socket effect need not depend on navigate and reconnect on every ticket switch.
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	const boardSlug = selectedBoard?.ref ?? boardId;

	const selectedIssue = state && issueId ? findIssue(state, issueId) : null;

	// Leaving a ticket with unsent text asks first. Only leaving it: another of
	// its tabs, or anything that keeps it open, keeps the text.
	const leaveBlocker = useBlocker(
		({currentLocation, nextLocation}) =>
			Boolean(selectedIssue) &&
			ticketInPath(currentLocation.pathname) !==
				ticketInPath(nextLocation.pathname) &&
			hasTicketDrafts(selectedIssue!.id),
	);

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

	// The open lane panel and its tab; not in the URL, it is not worth linking to.
	const [detailsSwimlaneId, setDetailsSwimlaneId] = useState<string | null>(
		null,
	);
	const [laneTab, setLaneTab] = useState<SwimlaneDetailsTab>('overview');
	// The board on screen's own panel, for the same reason.
	const [boardDetailsOpen, setBoardDetailsOpen] = useState(false);
	// The narrowed-to goal's panel, opened with its pill and with a link to it.
	const [goalDetailsOpen, setGoalDetailsOpen] = useState(() =>
		Boolean(selection.goal),
	);

	const commentsByIssueId = state?.commentsByIssueId ?? EMPTY_COMMENTS;

	// Descriptions, comment bodies and commits, fetched for the one open ticket.
	const {
		detail: issueDetail,
		commits: issueCommits,
		commitDiffs: issueCommitDiffs,
		loadCommitDiff: loadIssueCommitDiff,
		stats: issueStats,
		loadStats: loadIssueStats,
		squashed: issueSquashedDiff,
		loadSquashedDiff: loadIssueSquashedDiff,
		updateComments: updateDetailComments,
		onMessage: onIssueDetailMessage,
	} = useIssueDetail({
		issueId: selectedIssue?.id ?? null,
		asOfTime: scrubCut(state?.timeTravel),
		boardState: state,
		// The board's own state is what a movie is showing; the panel is not
		// even on screen.
		paused: theatre !== null,
		sendRaw,
	});
	const {stats: swimlaneStats, onMessage: onSwimlaneStatsMessage} =
		useSwimlaneStats({
			swimlaneId: laneTab === 'stats' ? detailsSwimlaneId : null,
			sendRaw,
		});
	const {overview: boardOverview, onMessage: onBoardOverviewMessage} =
		useBoardOverview({
			boardId:
				boardDetailsOpen && state?.timeTravel?.mode !== 'scrub'
					? selectedBoard?.id ?? null
					: null,
			sendRaw,
		});

	const [managingGoals, setManagingGoals] = useState(false);

	// The bar beside a card's ref, fetched once for the repository.
	const {stats: refDiffStats, onMessage: onRefDiffStatsMessage} =
		useRefDiffStats({
			socketEpoch,
			asOfTime: scrubCut(state?.timeTravel),
			sendRaw,
		});

	// The card a linkified ticket ref shows on hover. Most of it is already in
	// `state`; only the description excerpt is fetched.
	const {
		previewFor: ticketPreviewFor,
		requestPreview: requestTicketPreview,
		onMessage: onTicketPreviewMessage,
	} = useTicketPreviews({state, sendRaw});

	// The settings panel: behind the header's avatar, and the palette.
	// Everything it shows is fetched on opening it.
	const [settings, setSettings] = useState<SettingsFocus | null>(null);
	const settingsOpen = settings !== null;
	const closeSettings = useCallback(() => setSettings(null), []);
	// The button that opens it, which a click on must not count as outside,
	// and the topbar it sits under.
	const settingsButtonRef = useRef<HTMLSpanElement | null>(null);
	const topbarRef = useRef<HTMLDivElement | null>(null);
	const contributorEmails = useContributorEmails({
		open: settingsOpen,
		sendRaw,
	});
	// Sync settings and personal totals, fetched when the panel opens; totals again after a claim.
	const syncSettings = useSyncSettings({open: settingsOpen, sendRaw});
	const updateInfo = useUpdateInfo({socketEpoch, sendRaw});
	// The other repos whose commits count as the board's.
	const repos = useRepos({open: settingsOpen, sendRaw, socketEpoch});
	const registeredRepoIds = useMemo(
		() => repos.data?.repos.map(repo => repo.id) ?? null,
		[repos.data],
	);
	const repoLabels = useMemo(
		() =>
			new Map(
				repos.data?.repos.map(repo => [repo.id, repo.label] as const) ?? [],
			),
		[repos.data],
	);
	const personalStats = usePersonalStats({
		open: settingsOpen,
		changed: contributorEmails.changed,
		sendRaw,
	});

	// Fetched on opening the tab, as it scans every commit. Keyed on the newest
	// sha too, so a commit landing while it is open refetches.
	const statsSignature =
		issueCommits?.issueId === selectedIssue?.id
			? issueCommits?.commits[0]?.sha ?? ''
			: '';

	useEffect(() => {
		if (selectedTab !== 'stats' || !selectedIssue) return;

		loadIssueStats(selectedIssue.id, statsSignature);
	}, [selectedTab, selectedIssue?.id, statsSignature, loadIssueStats]);

	// The Code tab's last chosen view, kept across tickets.
	const [compactedDiffStored, setCompactedDiffStored] = usePersistedFlag(
		COMPACTED_DIFF_STORAGE_KEY,
		false,
	);

	// A view named in the route wins without overwriting the reader's own choice.
	const linkedDiffView = readDiffViewParam(searchParams);
	const compactedDiffPreferred = linkedDiffView
		? linkedDiffView === 'flat'
		: compactedDiffStored;

	// A commit deep link holds the tab on the commits, which compacted cannot show.
	const compactedDiff = compactedDiffPreferred && !diffFocus;

	// Both URL and stored preference; replaced rather than pushed.
	const chooseDiffView = (next: boolean) => {
		setCompactedDiffStored(next);
		setSearchParams(
			prev => {
				const params = new URLSearchParams(prev);
				writeDiffViewParam(params, next);

				return params;
			},
			{replace: true},
		);
	};

	// Writes the reader's chosen view into the URL on opening the tab, so a copied
	// link lands on it.
	useEffect(() => {
		if (selectedTab !== 'code' || !selectedIssue) return;
		if (readDiffViewParam(searchParams)) return;
		// The switch is disabled under a commit link, so there is no choice to write.
		if (diffFocus) return;

		setSearchParams(
			prev => {
				const params = new URLSearchParams(prev);
				writeDiffViewParam(params, compactedDiffPreferred);

				return params;
			},
			{replace: true},
		);
	}, [
		selectedTab,
		selectedIssue?.id,
		searchParams,
		compactedDiffPreferred,
		diffFocus,
	]);

	// Costs the same git walk the stats do, and on the same signature, so it is
	// asked for when the view is opened rather than with the ticket.
	useEffect(() => {
		// An empty signature means no commits yet; the effect reruns when they land.
		if (selectedTab !== 'code' || !compactedDiff || !selectedIssue) return;
		if (!statsSignature) return;

		loadIssueSquashedDiff(selectedIssue.id, statsSignature);
	}, [
		selectedTab,
		compactedDiff,
		selectedIssue?.id,
		statsSignature,
		loadIssueSquashedDiff,
	]);

	// The board's half of the Stats tab, derived here where the lane order is known.
	const boardStats = useMemo(() => {
		if (!selectedIssue || !state) return null;

		const board = state.boards.find(candidate =>
			candidate.swimlanes.some(lane =>
				lane.issues.some(issue => issue.id === selectedIssue.id),
			),
		);
		const lane = board?.swimlanes.find(candidate =>
			candidate.issues.some(issue => issue.id === selectedIssue.id),
		);

		if (!board || !lane) return null;

		return deriveBoardStats({
			createdAt: selectedIssue.createdAt,
			enteredLaneAt: selectedIssue.enteredLaneAt,
			now: Date.now(),
			history:
				issueDetail?.issueId === selectedIssue.id ? issueDetail.history : [],
			lanes: board.swimlanes,
			currentLaneId: lane.id,
		});
	}, [selectedIssue?.id, state, issueDetail]);

	const issueActivity = useMemo(
		() =>
			issueActivityLogEntries(
				selectedIssue && issueDetail?.issueId === selectedIssue.id
					? issueDetail.history
					: [],
				selectedIssue && issueCommits?.issueId === selectedIssue.id
					? issueCommits.commits
					: [],
			),
		[selectedIssue?.id, issueDetail, issueCommits],
	);

	// The text box beside the board switcher; not in the URL.
	const [textFilter, setTextFilter] = useState('');
	// One entry per narrowed axis, and empty while nothing is narrowed. Every
	// axis has to pass, so a tag and an assignee ask one question together.
	const boardFilter = useMemo(
		() => buildBoardFilter(selection.only),
		[selection.only],
	);

	// Who caused an event on each ticket. Null past the server's cap, and while
	// no one narrows by actor, since this walks the whole window.
	const narrowsByActor = selection.only.actor !== undefined;
	const eventActorIds = useMemo(
		() => (narrowsByActor ? actorIdsByIssue(history.timeline) : null),
		[narrowsByActor, history.timeline],
	);

	const zoomed = selection.zoom !== null;

	// Tickets with an event in the scrubber's window, or null when not narrowed or
	// the window is counts only. The test that greys the box, so a greyed one hides nothing.
	const windowIds = useMemo(
		() =>
			selection.windowOnly && isPeriodWindow(selection.scope, zoomed)
				? windowIssueIds(history.timeline)
				: null,
		[selection.windowOnly, selection.scope, zoomed, history.timeline],
	);

	// Narrows the board to the open ticket too; only while one is actually open.
	const isolatedIssueId =
		selection.ticketOnly && selectedIssue ? selectedIssue.id : null;

	// The tag the tag axis is narrowed to, if exactly one: its chips read as pressed.
	const tagOnly = narrowedIds(selection.only.tag);
	const isolatedTagId = tagOnly?.length === 1 ? tagOnly[0] ?? null : null;

	// Narrowing to a chip also points the chart at tags; pressing the lit one again
	// lets go and turns the axis off.
	const filterByTag = (tagId: string) =>
		changeSelection({
			only: withNarrowing(
				selection.only,
				'tag',
				isolateOnly(tagOnly, tagId) ?? undefined,
			),
		});

	// The goal the board is narrowed to, only while it is still one of this board's.
	const isolatedGoalId =
		selection.goal &&
		selectedBoard?.goals.some(goal => goal.id === selection.goal)
			? selection.goal
			: null;
	// Narrowing to a goal opens its panel over whatever the inspector held.
	const filterByGoal = (goalId: string) => {
		const narrowing = isolatedGoalId !== goalId;
		setGoalDetailsOpen(narrowing);
		if (narrowing) {
			setCommitDiff(null);
			setDetailsSwimlaneId(null);
			setBoardDetailsOpen(false);
			clearPicked();
		}
		changeSelection({goal: narrowing ? goalId : null});
	};
	const detailedGoal =
		goalDetailsOpen && isolatedGoalId
			? state?.goals.find(goal => goal.id === isolatedGoalId) ?? null
			: null;
	const [goalTab, setGoalTab] = useState<GoalDetailsTab>('overview');
	// Walks every ticket, so only while a tab that needs it is open.
	const codeGoalId =
		detailedGoal && goalTab !== 'overview' ? detailedGoal.id : null;
	const goalSignature = useMemo(
		() =>
			codeGoalId && state
				? goalCodeSignature(codeGoalId, state.boards, refDiffStats)
				: '',
		[codeGoalId, state?.boards, refDiffStats],
	);
	const goalAsk = {
		signature: goalSignature,
		socketEpoch,
		asOfTime: scrubCut(state?.timeTravel),
		sendRaw,
	};
	const {answer: goalStats, onMessage: onGoalStatsMessage} =
		useGoalAnswer<IssueStatsValue>({
			...goalAsk,
			ask: 'stats',
			goalId: goalTab === 'stats' ? codeGoalId : null,
		});
	const {answer: goalCommits, onMessage: onGoalCommitsMessage} = useGoalAnswer<
		GuiRefCommitEntry[]
	>({
		...goalAsk,
		ask: 'commits',
		goalId: goalTab === 'code' ? codeGoalId : null,
	});

	// The same for the assignee axis, from a dense card's name: the board
	// narrowed to one person's tickets, and pressing the name again lets go.
	const assigneeOnly = narrowedIds(selection.only.assignee);
	const isolatedAssigneeId =
		assigneeOnly?.length === 1 ? assigneeOnly[0] ?? null : null;
	const filterByAssignee = (assigneeId: string) =>
		changeSelection({
			only: withNarrowing(
				selection.only,
				'assignee',
				isolateOnly(assigneeOnly, assigneeId) ?? undefined,
			),
		});

	// For naming a selected identity the scrubber's window has no event for.
	const knownIdentities = useMemo(() => {
		const people = new Map<string, GuiUser>();
		for (const person of [...(state?.contributors ?? []), ...contributors]) {
			if (!people.has(person.id)) people.set(person.id, person);
		}
		const users = [...people.values()];

		return {
			tag: state?.tags ?? [],
			commenter: users,
			assignee: users,
			actor: users,
		} satisfies Record<FilterAxis, GuiEventIdentity[]>;
	}, [state?.tags, state?.contributors, contributors]);

	// Every ticket on every board by its ref, for the chart: it plots the
	// repository, so a link there can name a ticket on any board.
	const issueIdByRef = useMemo(
		() => issueIdByRefFor(state?.boards ?? [], null),
		[state?.boards],
	);

	// The log's own, down to the board on screen — the rule `onThisBoard`
	// already applies to its events.
	const boardIssueIdByRef = useMemo(
		() => issueIdByRefFor(state?.boards ?? [], selectedBoardId),
		[state?.boards, selectedBoardId],
	);

	// What the flow layout draws from.
	const boardLanes = useMemo(
		() => (selectedBoard?.swimlanes ?? []).map(({id, title}) => ({id, title})),
		[selectedBoard],
	);
	const laneTitles = useMemo(
		() =>
			new Map(
				(state?.boards ?? []).flatMap(board =>
					board.swimlanes.map(lane => [lane.id, lane.title] as const),
				),
			),
		[state?.boards],
	);
	const issueSummaryById = useMemo(
		() =>
			new Map(
				(state?.boards ?? []).flatMap(board =>
					board.swimlanes.flatMap(swimlane =>
						swimlane.issues.map(
							issue =>
								[
									issue.id,
									{
										ref: issue.ref,
										title: issue.title,
										assignee: issue.assignees[0] ?? null,
									},
								] as const,
						),
					),
				),
			),
		[state?.boards],
	);

	// The tickets the text query keeps, or null with no query.
	const queryIssueIds = useMemo(() => {
		const query = textFilter.trim();
		if (!query || !selectedBoard) return null;

		return new Set(
			selectedBoard.swimlanes.flatMap(swimlane =>
				swimlane.issues
					.filter(issue => issueMatchesText(issue, query))
					.map(issue => issue.id),
			),
		);
	}, [selectedBoard, textFilter]);

	// Returns the lanes untouched when nothing is filtered, keeping SwimlaneColumn's memo.
	const {visibleSwimlanes, hiddenIssueCount} = useMemo(() => {
		const swimlanes = selectedBoard?.swimlanes ?? [];
		const query = textFilter.trim();
		if (
			boardFilter.length === 0 &&
			!query &&
			windowIds === null &&
			!isolatedIssueId &&
			!isolatedGoalId
		)
			return {visibleSwimlanes: swimlanes, hiddenIssueCount: 0};

		let hidden = 0;

		const visible = swimlanes.map(swimlane => {
			const issues = swimlane.issues.filter(
				issue =>
					issuePassesBoardFilter(
						issue,
						{
							commenterIds: (commentsByIssueId[issue.id] ?? []).map(
								comment => comment.author.id,
							),
							actorIds:
								eventActorIds === null
									? null
									: [...(eventActorIds.get(issue.id) ?? [])],
						},
						boardFilter,
					) &&
					issueMatchesText(issue, query) &&
					(windowIds === null || windowIds.has(issue.id)) &&
					(!isolatedIssueId || issue.id === isolatedIssueId) &&
					(!isolatedGoalId || issue.goal?.id === isolatedGoalId),
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
		eventActorIds,
		windowIds,
		isolatedIssueId,
		isolatedGoalId,
	]);
	const attachmentsByIssueId = state?.attachmentsByIssueId ?? {};

	// Reads every frame; the connection itself is `useBoardSocket`'s.
	const onSocketMessage = (message: any, socket: BoardSocketActions) => {
		// Not exclusive: `commit:diff:result` is also read below, for the diff the
		// scrubber's own commit dot opens.
		onIssueDetailMessage(message);
		onSwimlaneStatsMessage(message);
		onGoalStatsMessage(message);
		onGoalCommitsMessage(message);
		onBoardOverviewMessage(message);
		onRefDiffStatsMessage(message);
		onTicketPreviewMessage(message);

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

		// Keyed off this request's own reply: a broadcast fires for everyone's creations.
		if (message.type === 'issues:create:result') {
			const origin = pendingFileTicketOrigin.current;
			pendingFileTicketOrigin.current = null;

			const created = getResultValue<{id: string}>(message.payload);

			const askedFrom = pendingCreateBoard.current;
			pendingCreateBoard.current = undefined;

			// `boardSlug`, not the route param, which is empty until the redirect off `/`.
			// Only opened while the reader is still on the board it was filed from.
			if (created && boardSlug && answersBoardOnScreen(askedFrom, boardSlug)) {
				void navigateRef.current(
					`/board/${boardSlug}/issue/${nodeRef(created.id)}?tab=overview`,
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

		// This client's own reply again, for the same reason: a broadcast would
		// drag everyone else's board to whatever was created last.
		if (message.type === 'board:create:result') {
			const created = getResultValue<{ref: string}>(message.payload);

			if (created) void navigateRef.current(`/board/${created.ref}`);
		}

		// Otherwise a refused mutation just looks ignored.
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

		contributorEmails.onMessage(message);
		syncSettings.onMessage(message);
		updateInfo.onMessage(message);
		repos.onMessage(message);
		personalStats.onMessage(message);

		if (message.type === 'contributors') {
			const next = getResultValue<GuiContributor[]>(message.payload);
			// A board switch can outrun this slow, board-scoped answer.
			if (
				next &&
				answersBoardOnScreen(message.boardId, selectedBoardIdRef.current)
			) {
				setContributors(next);
			}
		}

		if (message.type === 'commits') {
			const nextCommits = getResultValue<GuiCommitEntry[]>(message.payload);
			if (nextCommits) {
				historyBuffer.accept(message.requestId, {commits: nextCommits});
			}
		}

		if (message.type === 'commit:diff:result') {
			// Wrapped with its sha: two diffs can be in flight at once.
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
							? {
									...prev,
									loading: false,
									error: null,
									files: diff.files,
									body: diff.body,
							  }
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
		// One inspector, one subject: a lane's or the board's panel left open
		// would hide the ticket just asked for the same way.
		setDetailsSwimlaneId(null);
		setBoardDetailsOpen(false);
		setGoalDetailsOpen(false);

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

	// Clicking the lane's button for the tab on screen again closes the panel,
	// which is what a toggle on the thing itself has to do.
	const openSwimlaneDetails = (swimlaneId: string, tab: SwimlaneDetailsTab) => {
		setCommitDiff(null);
		clearPicked();
		closeIssueDetails();
		setBoardDetailsOpen(false);
		setGoalDetailsOpen(false);
		const open = detailsSwimlaneId === swimlaneId && laneTab === tab;
		setDetailsSwimlaneId(open ? null : swimlaneId);
		setLaneTab(tab);
	};

	const toggleBoardDetails = () => {
		setCommitDiff(null);
		clearPicked();
		closeIssueDetails();
		setDetailsSwimlaneId(null);
		setGoalDetailsOpen(false);
		setBoardDetailsOpen(open => !open);
	};

	// Refs that resolve to a real ticket on any board; only these are linkified,
	// since a ref looks like any uppercase word.
	const knownTicketRefs = useMemo(
		() => new Set(issueIdByRef.keys()),
		[issueIdByRef],
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

	// Opens a ticket at a named tab, on `board` if given (project-wide search),
	// else the board on screen.
	const openIssueTab = (
		nextIssueId: string,
		tab: IssueDetailsTab,
		board = boardSlug,
		// The Code tab view to land on; omitted to keep the reader's choice.
		diffView?: DiffViewName,
		// Replace for moves the reader did not make (following the log).
		replace = false,
		// The one comment to land on, where the thing being followed names one.
		comment?: string,
	) => {
		if (!board) return;

		setCommitDiff(null);
		setGoalDetailsOpen(false);

		const params = new URLSearchParams({tab});
		if (diffView) writeDiffViewParam(params, diffView === 'flat');
		if (comment) params.set('comment', comment);

		void navigate(`/board/${board}/issue/${nodeRef(nextIssueId)}?${params}`, {
			replace,
		});
	};

	// A card's own controls open its ticket, and make it the selection the way
	// a click on the card does.
	const selectCardTab = (
		nextIssueId: string,
		tab: IssueDetailsTab,
		diffView?: DiffViewName,
	) => {
		setDetailsSwimlaneId(null);
		setBoardDetailsOpen(false);
		setPickedIssueIds([nextIssueId]);
		openIssueTab(nextIssueId, tab, boardSlug, diffView);
	};

	const selectIssueComments = (nextIssueId: string) =>
		selectCardTab(nextIssueId, 'comments');

	// On whichever of the Code tab's views the reader last chose.
	const selectIssueCode = (nextIssueId: string) =>
		selectCardTab(nextIssueId, 'code');

	// Goes where lib/log-destination decided: a diff, the comments or the overview.
	const openLogDestination = (
		destination: LogDestination,
		options?: {replace?: boolean},
	) => {
		if (destination.kind === 'commit') {
			openCommitDiff(destination.sha, options?.replace);
			return;
		}

		openIssueTab(
			destination.issueId,
			destination.tab,
			undefined,
			undefined,
			options?.replace,
			destination.comment,
		);
	};

	// Pushed, so back returns to the stats.
	const openStatsFile = (file: {sha: string; path: string}) => {
		setSearchParams(prev => {
			const next = new URLSearchParams(prev);
			next.set('tab', 'code');
			writeFileFocusParams(next, file);

			return next;
		});
	};

	const changeIssueDetailsTab = (nextTab: IssueDetailsTab) => {
		setSearchParams(
			prev => {
				const next = new URLSearchParams(prev);
				next.set('tab', nextTab);
				// A deep link belongs to the Code tab and is dropped on leaving it.
				clearDiffLocationParams(next);
				// A linked view is for that one visit, not a setting.
				clearDiffViewParam(next);
				return next;
			},
			{replace: true},
		);
	};

	// The location goes in the URL, so it survives a reload and can be shared. Pushed.
	const openDiffLocation = (location: DiffLocation) => {
		// Another ticket's diff: go to that ticket's Code tab at the spot.
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

	const {
		attachmentUploadStatus,
		editIssueTitle,
		editIssueDescription,
		addIssueTag,
		removeIssueTag,
		setIssueGoal,
		createGoal,
		renameGoal,
		removeGoal,
		addIssueAssignee,
		removeContributor,
		removeTag,
		addExternalIssueAssignee,
		removeIssueAssignee,
		closeIssue,
		reopenIssue,
		addIssueComment,
		deleteIssueComment,
		editIssueComment,
		uploadIssueAttachments,
		deleteIssueAttachment,
	} = useIssueMutations({
		send,
		setState,
		contributors,
		updateComments: updateDetailComments,
		attachmentMaxKb: state?.attachmentMaxKb,
	});

	const scrubToTime = (targetTime: number) => {
		send('time-travel:scrub', {targetTime});
	};

	const returnToLive = () => {
		send('time-travel:live', {});
	};

	const [needleDragging, setNeedleDragging] = useState(false);
	const {settle: settleNeedle} = useNeedleUrl({
		cut: scrubCut(state?.timeTravel),
		state,
		socketEpoch,
		following: theatre === null,
		dragging: needleDragging,
		scrubTo: scrubToTime,
		goLive: returnToLive,
	});

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

	// A counter the scrubber refetches on. Handing it state would refetch at now
	// mid-movie, dropping the lines the playhead narrates.
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

	// A claim changes commit authorship, and the commit track comes from git, so
	// refetch it. Not gated on logOpen: the scrubber's dots show the names too.
	useEffect(() => {
		if (theatre) return;
		if (contributorEmails.changed === 0) return;

		setHistoryTick(tick => tick + 1);
	}, [contributorEmails.changed, theatre]);

	// The same for another repo's clone moving or leaving: its commits are on
	// the chart and in the log, and nothing on the board says they changed.
	useEffect(() => {
		if (theatre) return;
		if (repos.changed === 0) return;

		setHistoryTick(tick => tick + 1);
	}, [repos.changed, theatre]);

	// Where the reader is, in the same shape a log line resolves to.
	const readerAt: LogDestination | null = commitDiff
		? {kind: 'commit', sha: commitDiff.sha}
		: selectedIssue
		? {
				kind: 'ticket',
				issueId: selectedIssue.id,
				tab: selectedTab === 'comments' ? 'comments' : 'overview',
				...(focusedCommentId ? {comment: focusedCommentId} : {}),
		  }
		: null;

	// Which repos the Code series plots, for the chart and the log alike.
	const commitRepoFilter = useCommitRepoFilter(
		history.commits,
		registeredRepoIds,
	);
	const plottedCommits = commitRepoFilter.plotted;

	const {
		entries: logEntries,
		moment: logMoment,
		eventsUnlisted,
	} = useEventLog({
		open: logOpen,
		timeline: history.timeline,
		boardId: selectedBoardId ?? null,
		commits: plottedCommits,
		selection,
		selectedIssueId: selectedIssue?.id ?? null,
		queryIssueIds,
		linkedCommitsOnly,
		boardIssueIdByRef,
		issueIdByRef,
		showIssues,
		showCommits,
		playing: theatre !== null,
		playheadTime: playback.current?.t ?? null,
		timeTravel: state?.timeTravel,
	});

	// Whether the log panel, docked or popped out, is at its foot.
	const [logPinned, setLogPinned] = useState(true);

	// One definition for both hooks, so they never disagree.
	const boardIsLive =
		connected && state?.timeTravel?.mode !== 'scrub' && !theatre;

	const {following, setFollowing} = useFollowLog({
		// Docked or popped out, the follow runs here; only a shut log has nothing to follow.
		logOpen,
		// Not live during a checkout, a movie or offline.
		live: boardIsLive,
		onOpenLog: () => setLogOpen(true),
	});

	// One follow for both panels, run here because this is the side that slices
	// the log for both of them.
	const {followedLine} = useFollowedLine({
		following,
		live: boardIsLive,
		pinned: logPinned,
		entries: logEntries,
		at: readerAt,
		onOpen: openLogDestination,
	});

	const logWindow = useLogWindow({
		entries: logEntries,
		moment: logMoment,
		followedLine,
		eventsUnlisted,
		open: logOpen,
		onOpen: openLogDestination,
		onPinnedChange: setLogPinned,
	});

	// A dropped socket closes the movie: its frames come over the socket.
	useEffect(() => {
		if (!connected) setTheatre(null);
	}, [connected]);

	// Both requests share an id, returned so the caller can pair and discard replies.
	const requestBoardHistory = useCallback(
		(start?: number, end?: number, allBoards?: boolean): number => {
			const window = start !== undefined ? {start, end} : undefined;

			const requestId = historyBuffer.open();
			// No boardId means every board; the commit log is repository-wide. Null is refused.
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

	// Replays the whole log server-side, so fetched only when the assignee picker opens.
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

	// A linked commit opens on its ticket's Code tab; an unlinked one in the bare panel.
	const openCommitDiff = useCallback(
		(sha: string, replace = false) => {
			const commit = history.commits.find(entry => entry.sha === sha);
			const ref = commit
				? commitTicketRefs(commit, knownTicketRefs)[0]
				: undefined;

			if (ref && boardSlug) {
				// A bare panel left open by an earlier unlinked commit would sit in
				// front of the ticket this one opens, still showing that older diff.
				setCommitDiff(null);
				void navigate(
					`/board/${boardSlug}/issue/${ref}?tab=code&commit=${sha}`,
					{replace},
				);
				return;
			}

			const repo = commit?.repo;

			setCommitDiff({sha, loading: true, error: null, files: null});
			sendRaw({
				type: 'commit:diff:get',
				payload: repo ? {sha, repo} : {sha},
			});
		},
		[history.commits, knownTicketRefs, boardSlug, navigate],
	);

	const closeCommitDiff = useCallback(() => setCommitDiff(null), []);

	// Any route change closes an open diff, which would hide the ticket panel.
	// Reselecting the open ticket is cleared by selectIssue.
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

	// Every `issues:create` goes through here, recording the board it was asked from.
	const createIssueOn = (payload: {
		title: string;
		parentId: string;
		description?: string;
		tagNames?: string[];
	}) => {
		pendingCreateBoard.current = boardSlug;
		send('issues:create', payload);
	};

	const createIssue = () => {
		if (!createIssueModal) return;

		const title = createIssueModal.title.trim() || 'New ticket';
		const parentId = createIssueModal.swimlaneId;

		setCreateIssueModal(null);

		createIssueOn({title, parentId});
	};

	const {
		createSwimlaneTitle,
		setCreateSwimlaneTitle,
		renameSwimlane,
		setDeleteSwimlaneId,
		deletingSwimlane,
		createSwimlane,
		confirmDeleteSwimlane,
		setSwimlaneRule,
	} = useSwimlaneEditing({send, setState, selectedBoard, visibleSwimlanes});

	const {
		createBoardTitle,
		setCreateBoardTitle,
		createBoard,
		renameBoard,
		setRenameBoard,
		openRenameBoard,
		submitRenameBoard,
	} = useBoardEditing({send, setState, selectedBoard});

	const {saveNodeDescription} = useDescriptionEditing({send, setState});

	// Flattened once per state change rather than per keystroke: the palette
	// matches over this on every character typed into its second step.
	const searchableTickets = useMemo(
		() =>
			(state?.boards ?? []).flatMap(board =>
				board.swimlanes.flatMap(swimlane =>
					swimlane.issues.map(issue => ({
						id: issue.id,
						ref: issue.ref,
						title: issue.title,
						boardTitle: board.title,
						boardRef: board.ref,
					})),
				),
			),
		[state],
	);

	const commandPalette = useCommandPalette();
	const recentCommands = useRecentCommands();
	const commands = useMemo(() => buildCommandRegistry(), []);

	// Rebuilt each render: it reads most of the board, and only while the palette is open.
	const commandContext = {
		connected,
		scrubbing: state?.timeTravel?.mode === 'scrub',
		issue: selectedIssue,
		board: selectedBoard
			? {
					id: selectedBoard.id,
					title: selectedBoard.title,
					readonly: selectedBoard.readonly,
			  }
			: null,
		tags: state?.tags ?? [],
		goals: state?.goals ?? [],
		tickets: searchableTickets,
		contributors,
		handlers: {
			// The palette has no column in hand, so a ticket goes to the first one
			// — the same place the board's own + button starts from.
			createIssue: () => {
				const swimlaneId = visibleSwimlanes[0]?.id;
				if (swimlaneId) setCreateIssueModal({swimlaneId, title: ''});
			},
			createSwimlane: () => setCreateSwimlaneTitle(''),
			createBoard: () => setCreateBoardTitle(''),
			renameBoard: openRenameBoard,
			openBoardDetails: () => {
				if (!boardDetailsOpen) toggleBoardDetails();
			},
			openRepos: () => setSettings('repos'),
			openSettings: () => setSettings('overview'),
			openIssue: (id: string, boardRef: string) =>
				openIssueTab(id, 'overview', boardRef),
			closeIssue,
			reopenIssue,
			addIssueTag,
			removeIssueTag,
			setIssueGoal,
			manageGoals: () => setManagingGoals(true),
			addIssueAssignee,
			removeIssueAssignee,
			// Opens the thread rather than posting: what to say is the point, and
			// the palette has nowhere to say it.
			commentOnIssue: (id: string) => openIssueTab(id, 'comments'),
			copyRef: (ref: string) => void navigator.clipboard?.writeText(ref),
			sync: () => send('sync', {}),
			startTheatre,
			returnToLive,
			toggleLog: () => setLogOpen(!logOpen),
			toggleCardDensity: cardDensity.toggleDensity,
			toggleDenseTitleLines: cardDensity.toggleTitleLines,
		},
	};

	// A dead socket makes the board readonly, as mid-scrub. Not before the first
	// state, or every first paint would freeze.
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

	// The lane as the board has it now, including a replayed board.
	const detailsSwimlane =
		shownSwimlanes.find(swimlane => swimlane.id === detailsSwimlaneId) ?? null;

	// Read off the drop event: a drag can start in another window.
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

	const fileTicketFromSelection = (
		originIssueId: string,
		originRef: string,
		params: FileTicketParams,
	) => {
		// The leftmost lane: a ticket filed off a review is new work.
		const targetSwimlaneId = selectedBoard?.swimlanes[0]?.id;
		if (!targetSwimlaneId) return;

		// Same shape as a diff comment's body: note, then the linked snippet.
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

		createIssueOn({
			title: params.title,
			parentId: targetSwimlaneId,
			description,
			tagNames: ['from-code-comment'],
		});
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
		<RepoLabelsContext.Provider value={repoLabels}>
			<CardDensityContext.Provider
				value={{
					view: cardDensity.view,
					toggleDensity: cardDensity.toggleDensity,
				}}
			>
				<TicketRefLinksProvider value={ticketRefLinks}>
					<div
						style={{
							height: '100vh',
							background: GUI_THEME.bg,
							color: GUI_THEME.primary,
							fontFamily: MONO_FONT,
							display: 'flex',
							flexDirection: 'column',
						}}
					>
						<GlobalStyles />
						<TooltipLayer />
						<TicketPreviewLayer
							previewFor={ticketPreviewFor}
							onHover={requestTicketPreview}
						/>

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

						{/* The instrumentation, on chrome ground below the board. */}
						<div style={{background: GUI_THEME.chrome}}>
							{/* Dimmed and inert while a movie plays. */}
							<div
								ref={topbarRef}
								style={theatre ? DIMMED_WHILE_PLAYING : undefined}
							>
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
									update={updateInfo.update}
									scrubbing={state?.timeTravel?.mode === 'scrub'}
									syncStatus={syncStatus}
									onOpenCommands={() => commandPalette.setOpen(true)}
									board={
										<Dropdown
											testId="board-switcher"
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
													// Counted here, as the TUI's board list says it.
													hint: plural(
														board.swimlanes.reduce(
															(total, swimlane) =>
																total + swimlane.issues.length,
															0,
														),
														'ticket',
													),
												})) ?? []
											}
											placeholder="Loading…"
											onSelect={selectBoard}
											itemAction={{
												title: 'Board details',
												icon: <IconLaneStats size={ICON_SIZE} />,
												testId: 'board-details-open',
												isOpen: id =>
													boardDetailsOpen && selectedBoard?.id === id,
												// A toggle on the board it is open for, as a lane's is.
												onAction: id => {
													if (boardDetailsOpen && selectedBoard?.id === id) {
														setBoardDetailsOpen(false);
														return;
													}
													selectBoard(id);
													setCommitDiff(null);
													clearPicked();
													setDetailsSwimlaneId(null);
													setBoardDetailsOpen(true);
												},
											}}
										/>
									}
									notice={following ? <FollowBanner /> : undefined}
									settings={{
										open: settingsOpen,
										// Closes whatever is open, wherever it was opened from.
										onToggle: () =>
											setSettings(open => (open ? null : 'overview')),
										ref: settingsButtonRef,
									}}
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
								onOpenIssue={id => openIssueTab(id, 'overview')}
								highlightEventId={hoveredLogEventId}
								timeTravel={state?.timeTravel ?? {mode: 'live', asOfTime: null}}
								onScrub={scrubToTime}
								onNeedleDragging={setNeedleDragging}
								onNeedleSettle={settleNeedle}
								onReturnToLive={returnToLive}
								onPlayTheatre={startTheatre}
								theatreOpen={theatre !== null}
								logOpen={logOpen}
								onChangeLogOpen={setLogOpen}
								showIssues={showIssues}
								onChangeShowIssues={setShowIssues}
								showCommits={showCommits}
								onChangeShowCommits={setShowCommits}
								linkedCommitsOnly={linkedCommitsOnly}
								onChangeLinkedCommitsOnly={setLinkedCommitsOnly}
								commitRepos={commitRepoFilter.repos}
								hiddenCommitRepos={commitRepoFilter.hidden}
								onToggleCommitRepo={commitRepoFilter.toggle}
								issueIdByRef={issueIdByRef}
								boardIssueIdByRef={boardIssueIdByRef}
								lanes={boardLanes}
								laneTitles={laneTitles}
								issueSummaryById={issueSummaryById}
								selection={selection}
								onChangeSelection={changeSelection}
								selectedIssue={
									selectedIssue
										? {id: selectedIssue.id, createdAt: selectedIssue.createdAt}
										: null
								}
								textFilter={textFilter}
								onChangeTextFilter={setTextFilter}
								queryIssueIds={queryIssueIds}
								knownIdentities={knownIdentities}
								refreshOn={historyTick}
								following={following}
								onChangeFollowing={setFollowing}
							/>
						</div>

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
							{/* Log and board as one row, a column for a bottom dock. */}
							<div
								style={{
									display: 'flex',
									flex: 1,
									minWidth: 0,
									minHeight: 0,
									overflow: 'hidden',
								}}
							>
								{logReveal.mounted && !logWindow.poppedOut && (
									<EventLog
										revealed={logReveal.shown}
										settled={logReveal.settled}
										entries={logEntries}
										moment={logMoment}
										onHoverEvent={setHoveredLogEventId}
										bottomClearance={theatre ? THEATRE_PLAYER_CLEARANCE : 0}
										onOpen={openLogDestination}
										at={readerAt}
										followedLine={followedLine}
										eventsUnlisted={eventsUnlisted}
										onPinnedChange={setLogPinned}
										onPopOut={logWindow.popOut}
									/>
								)}

								{/* Vertical overflow hidden: the lanes scroll themselves. */}
								<main
									// A click past it closes the lane and board panels unless their description
									// is half-written; the ticket panel stays open (details-close.pw.ts).
									onClick={() => {
										clearPicked();
										if (
											!detailsSwimlaneId ||
											!hasTicketDrafts(detailsSwimlaneId)
										) {
											setDetailsSwimlaneId(null);
										}
										if (!selectedBoard || !hasTicketDrafts(selectedBoard.id)) {
											setBoardDetailsOpen(false);
										}
									}}
									style={{
										// No top inset: lane headers carry their own gap.
										padding: `0 0 0 ${BOARD_GUTTER}px`,
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
									{selectedBoard && selectedBoard.goals.length > 0 && (
										<GoalStrip
											goals={selectedBoard.goals}
											isolatedGoalId={isolatedGoalId}
											onFilterByGoal={filterByGoal}
											onManage={
												selectedBoard.readonly
													? undefined
													: () => setManagingGoals(true)
											}
										/>
									)}
									{managingGoals && (
										<ManageGoalsModal
											goals={state?.goals ?? []}
											onCreate={name => createGoal(name)}
											onRename={renameGoal}
											onRemove={removeGoal}
											onClose={() => setManagingGoals(false)}
										/>
									)}
									{/* Scrolls sideways; each column scrolls down. */}
									<div
										style={{
											display: 'flex',
											gap: 8,
											flex: 1,
											minHeight: 0,
											overflowX: 'auto',
											overflowY: 'hidden',
											// Lit but not touchable during a movie.
											pointerEvents: theatre ? 'none' : undefined,
											// Clears the floating player, so no card plays behind it.
											paddingBottom: theatre ? THEATRE_PLAYER_CLEARANCE : 0,
											transition: 'padding-bottom 240ms ease',
										}}
									>
										{shownSwimlanes.map((swimlane, laneIndex) => (
											<SwimlaneColumn
												key={swimlane.id}
												swimlane={swimlane}
												middle={
													laneIndex > 0 && laneIndex < shownSwimlanes.length - 1
												}
												live={state?.timeTravel?.mode !== 'scrub'}
												diffStats={refDiffStats}
												openTab={
													detailsSwimlaneId === swimlane.id ? laneTab : null
												}
												onOpenDetails={openSwimlaneDetails}
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
												onSelectIssueCode={selectIssueCode}
												isolatedTagId={isolatedTagId}
												onFilterByTag={filterByTag}
												isolatedGoalId={isolatedGoalId}
												onFilterByGoal={filterByGoal}
												isolatedAssigneeId={isolatedAssigneeId}
												onFilterByAssignee={filterByAssignee}
												onCreateIssue={openCreateIssueModal}
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

										{/* Appended where `createSwimlane` ranks the new lane; hidden when readonly. */}
										{selectedBoard && !selectedBoard.readonly && !offline && (
											<AddSwimlaneColumn
												onClick={() => setCreateSwimlaneTitle('')}
											/>
										)}

										{/* Reserves the closed side panel's width (also closed by a film), so the
										board keeps its max scrollLeft and does not bounce back. */}
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

							{/* Side panels close for the film; the ticket stays selected. */}
							{!theatre && commitDiff && (
								<Aside dock={asideDock} onWidthChange={setCommitDiffPanelWidth}>
									{({isFullscreen, toggleFullscreen}) => (
										<DiffPanel
											sha={commitDiff.sha}
											subject={
												history.commits.find(
													commit => commit.sha === commitDiff.sha,
												)?.subject ?? ''
											}
											body={commitDiff.body}
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

							{!theatre && !commitDiff && detailsSwimlane && (
								<SwimlaneDetails
									dock={asideDock}
									swimlane={detailsSwimlane}
									tab={laneTab}
									onChangeTab={setLaneTab}
									state={swimlaneStats}
									live={state?.timeTravel?.mode !== 'scrub'}
									onRename={title => renameSwimlane(detailsSwimlane.id, title)}
									onSetRule={(rule, on) =>
										setSwimlaneRule(detailsSwimlane.id, rule, on)
									}
									onDelete={() => setDeleteSwimlaneId(detailsSwimlane.id)}
									onSaveDescription={text =>
										saveNodeDescription(
											{kind: 'swimlane', id: detailsSwimlane.id},
											text,
										)
									}
									onClose={() => setDetailsSwimlaneId(null)}
								/>
							)}

							{!theatre &&
								!commitDiff &&
								!detailsSwimlane &&
								boardDetailsOpen &&
								selectedBoard && (
									<BoardDetails
										dock={asideDock}
										board={selectedBoard}
										overview={boardOverview}
										live={state?.timeTravel?.mode !== 'scrub'}
										onSaveDescription={text =>
											saveNodeDescription(
												{kind: 'board', id: selectedBoard.id},
												text,
											)
										}
										onClose={() => setBoardDetailsOpen(false)}
									/>
								)}

							{!theatre &&
								!commitDiff &&
								!detailsSwimlane &&
								!boardDetailsOpen &&
								detailedGoal &&
								selectedBoard &&
								state && (
									<GoalDetails
										dock={asideDock}
										goal={detailedGoal}
										boards={state.boards}
										boardId={selectedBoard.id}
										tab={goalTab}
										onChangeTab={setGoalTab}
										commits={goalCommits}
										commitDiffsBySha={issueCommitDiffs}
										onLoadCommitDiff={loadIssueCommitDiff}
										stats={goalStats}
										readonly={state.timeTravel?.mode === 'scrub'}
										onSaveDescription={text =>
											saveNodeDescription(
												{kind: 'goal', id: detailedGoal.id},
												text,
											)
										}
										onOpenIssue={(id, boardRef) => {
											setPickedIssueIds([id]);
											openIssueTab(id, 'overview', boardRef);
										}}
										onClose={() => setGoalDetailsOpen(false)}
									/>
								)}

							{!theatre &&
								!commitDiff &&
								!detailsSwimlane &&
								!boardDetailsOpen &&
								!detailedGoal &&
								pickedIssues.length > 1 && (
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
										onRemoveTag={tagId =>
											forPicked(id => removeIssueTag(id, tagId))
										}
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
								!detailsSwimlane &&
								!boardDetailsOpen &&
								!detailedGoal &&
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
													? {
															...selectedIssue,
															description: issueDetail.description,
													  }
													: selectedIssue;

											return offline ? {...base, readonly: true} : base;
										})()}
										activeTab={selectedTab}
										comments={
											issueDetail?.issueId === selectedIssue.id
												? issueDetail.comments
												: []
										}
										onChangeTab={changeIssueDetailsTab}
										onClose={closeIssueDetails}
										timelineNarrowed={selection.ticketOnly}
										timelineCapped={
											selection.ticketOnly &&
											!windowNamesIssues(history.timeline)
										}
										canNarrowTimeline={connected || selection.ticketOnly}
										onChangeTimelineNarrowed={next =>
											changeSelection({ticketOnly: next})
										}
										onEditTitle={editIssueTitle}
										onEditDescription={editIssueDescription}
										onAddTag={addIssueTag}
										onRemoveTag={removeIssueTag}
										goals={state?.goals ?? []}
										onSetGoal={setIssueGoal}
										{...(selectedIssue &&
											!selectedIssue.readonly && {
												onCreateGoal: (name: string) =>
													createGoal(name, selectedIssue.id),
												onManageGoals: () => setManagingGoals(true),
											})}
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
										focusedCommentId={focusedCommentId}
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
										diffView={{
											compacted: compactedDiff,
											onChangeCompacted: chooseDiffView,
											squashed:
												issueSquashedDiff?.issueId === selectedIssue.id
													? issueSquashedDiff.diff
													: null,
											// No entry for this ticket yet means its fetch is about to
											// be sent, not that it has nothing.
											loading:
												issueSquashedDiff?.issueId === selectedIssue.id
													? issueSquashedDiff.loading
													: true,
											error:
												issueSquashedDiff?.issueId === selectedIssue.id
													? issueSquashedDiff.error
													: null,
										}}
										stats={
											issueStats?.issueId === selectedIssue.id
												? issueStats.stats
												: null
										}
										statsLoading={
											issueStats?.issueId === selectedIssue.id
												? issueStats.loading
												: true
										}
										onOpenStatsFile={openStatsFile}
										boardStats={boardStats}
										activity={issueActivity}
										statsError={
											issueStats?.issueId === selectedIssue.id
												? issueStats.error
												: null
										}
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
								onExit={exitTheatre}
							/>
						)}

						{createIssueModal && (
							<CreateNodeModal
								eyebrow="New ticket"
								placeholder="Ticket name"
								title={createIssueModal.title}
								onChangeTitle={title =>
									setCreateIssueModal(prev => (prev ? {...prev, title} : prev))
								}
								onCreate={createIssue}
								onClose={() => setCreateIssueModal(null)}
							/>
						)}

						{leaveBlocker.state === 'blocked' && (
							<ConfirmModal
								eyebrow="Unsent"
								heading="Discard what you wrote?"
								body="This ticket has text you have not saved or sent."
								confirmLabel="Discard"
								onConfirm={() => {
									if (selectedIssue) discardTicketDrafts(selectedIssue.id);
									leaveBlocker.proceed();
								}}
								onClose={() => {
									leaveBlocker.reset();
									// A card click picks the card it was aimed at before it
									// navigates; staying means the open ticket is the pick.
									setPickedIssueIds(selectedIssue ? [selectedIssue.id] : []);
								}}
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
								confirmLabel="Delete"
								onConfirm={confirmDeleteSwimlane}
								onClose={() => setDeleteSwimlaneId(null)}
							/>
						)}

						{settings && (
							<SettingsPanel
								section={settings}
								below={topbarRef}
								keepOpenFor={[settingsButtonRef]}
								onClose={closeSettings}
								sections={[
									{
										id: 'identity',
										title: 'User stats',
										scope: 'Your board',
										// Who, beside how much: the title does not say.
										summary: [
											state?.user
												? actorDisplay(state.user.name).label
												: 'Not configured',
											personalStats.data?.scanned
												? `${personalStats.data.commits} commits`
												: null,
										]
											.filter(Boolean)
											.join(' · '),
										content: (
											<div data-testid="identity-panel">
												<IdentityStats state={personalStats} />
											</div>
										),
									},
									{
										id: 'addresses',
										title: 'Claimed Git addresses',
										scope: 'Your board',
										summary: contributorEmails.data
											? countOrNone(contributorEmails.data.mine.length)
											: null,
										content: (
											<IdentityAddresses
												state={contributorEmails}
												onLink={contributorEmails.link}
												onUnlink={contributorEmails.unlink}
											/>
										),
									},
									{
										id: 'sync',
										title: 'Auto sync',
										scope: 'This machine',
										summary: syncSettings.data
											? syncSettings.data.enabled
												? 'On'
												: 'Off'
											: null,
										content: (
											<IdentitySettings
												state={syncSettings}
												onChange={syncSettings.change}
											/>
										),
									},
									{
										id: 'repos',
										title: 'Connected repositories',
										scope: 'Shared with the project',
										summary: repos.data
											? countOrNone(repos.data.repos.length)
											: null,
										content: (
											<ReposSettings
												state={repos}
												onPreview={repos.previewRepo}
												onConfirm={repos.confirmPreview}
												onCancelPreview={repos.cancelPreview}
												onChange={repos.change}
												onRemove={repos.remove}
											/>
										),
									},
								]}
							/>
						)}

						{createBoardTitle !== null && (
							<CreateNodeModal
								eyebrow="New board"
								placeholder="Board name"
								title={createBoardTitle}
								onChangeTitle={setCreateBoardTitle}
								onCreate={createBoard}
								onClose={() => setCreateBoardTitle(null)}
							/>
						)}

						{renameBoard && (
							<CreateNodeModal
								eyebrow="Rename board"
								placeholder="Board name"
								confirmLabel="Rename"
								title={renameBoard.title}
								onChangeTitle={title =>
									setRenameBoard(prev => (prev ? {...prev, title} : prev))
								}
								onCreate={submitRenameBoard}
								onClose={() => setRenameBoard(null)}
							/>
						)}

						{createSwimlaneTitle !== null && (
							<CreateNodeModal
								eyebrow="New swimlane"
								placeholder="Swimlane name"
								title={createSwimlaneTitle}
								onChangeTitle={setCreateSwimlaneTitle}
								onCreate={createSwimlane}
								onClose={() => setCreateSwimlaneTitle(null)}
							/>
						)}

						{commandPalette.open && (
							<CommandPalette
								commands={commands}
								context={commandContext}
								recentIds={recentCommands.ids}
								onRun={command => recentCommands.remember(command.id)}
								onClose={() => commandPalette.setOpen(false)}
							/>
						)}
					</div>
				</TicketRefLinksProvider>
			</CardDensityContext.Provider>
		</RepoLabelsContext.Provider>
	);
};
