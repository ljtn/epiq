import http from 'node:http';
import {WebSocket, WebSocketServer} from 'ws';
import {
	addIssueAssignee,
	getBoardContributors,
	tombstoneContributor,
	tombstoneTag,
	addIssueComment,
	addIssueTag,
	setIssueGoal,
	createGoal,
	renameGoal,
	removeGoal,
	closeIssue,
	createBoard,
	editBoardTitle,
	editBoardDescription,
	editSwimlaneDescription,
	editGoalDescription,
	setSwimlaneRule,
	createIssue,
	createSwimlane,
	deleteSwimlane,
	deleteIssueComment,
	editIssueComment,
	deriveGuiState,
	editIssueDescription,
	editSwimlaneTitle,
	editIssueTitle,
	getGuiState,
	getIssueDescription,
	getIssueHistory,
	getPersonalStats,
	listIssues,
	moveIssue,
	moveSwimlane,
	removeIssueAssignee,
	removeIssueTag,
	reopenIssue,
	sync,
	cancelRepoConnect,
	connectRepo,
	fetchRepos,
	listRepos,
	disconnectRepo,
} from '../../../mcp/epiq-api.js';
import {
	REPO_RENAMED,
	REPO_UNCHANGED,
	getCommitDiff,
	getCommitTimeline,
	getCommitsForRef,
	withCommitBodies,
	getSquashedDiffForRef,
	openCommitDiffInEditor,
	readOwnRepo,
} from '../../../lib/commits/commits.js';
import {
	checkoutStateAt,
	checkoutStateAtEvent,
	getEventTimeline,
	getTimeTravelStatus,
	returnToLive,
	runExclusive,
} from '../../../mcp/epiq-time-travel.js';
import {getIssueStats} from '../../../mcp/epiq-issue-stats.js';
import {getRefDiffTimeline} from '../../../mcp/api/ref-diff-stats.js';
import {getSwimlaneStats} from '../../../mcp/api/swimlane-stats.js';
import {getGoalCommits, getGoalStats} from '../../../mcp/api/goal-code.js';
import {getBoardOverview} from '../../../mcp/api/board-overview.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../../lib/model/result-types.js';
import {NO_PROJECT_MESSAGE} from '../../../lib/storage/paths.js';
import {withCommitAuthors} from '../../../mcp/api/commit-authors.js';
import {
	linkContributorEmail,
	listContributorEmails,
	suggestOwnEmails,
	unlinkContributorEmail,
} from '../../../mcp/api/emails.js';
import {
	readAutoSyncSettings,
	writeAutoSyncSettings,
} from '../../../lib/config/sync-settings.js';
import {nodeRef} from '../../../lib/utils/node-ref.js';
import {
	broadcastGuiMessage,
	registerGuiSocket,
} from '../../client/lib/gui-broadcast.js';
import {MUTATING_MESSAGE_TYPES} from '../../client/lib/gui-mutations.js';
import {
	GuiProject,
	recentProjectViews,
	resolveRecentProjectRoot,
} from './gui-project.js';
import {GuiMessage} from './websocket.model.js';
import {isForeignOrigin} from './origin-guard.js';
import {parseGuiMessage} from './websocket.schema.js';
import {getUpdateInfo} from '../../../lib/version/version-check.js';
import {EPIQ_VERSION} from '../../../version.js';
import {issueDetail, issuePreview, slimStateResult} from './slim-state.js';

/** The ceiling on one frame: far above the longest description, far below `ws`'s 100 MiB default. */
export const MAX_SOCKET_FRAME_BYTES = 1024 * 1024;

// Derives rather than boots, so a live re-materialize can't stomp a checkout.
const broadcastDerivedState = () => {
	broadcastGuiMessage({
		type: 'state',
		payload: slimStateResult(deriveGuiState()),
	});
};

/** Commits in the other repos moved or a repo left: every client refetches them. */
const broadcastReposChanged = () => {
	broadcastGuiMessage({type: 'repos:changed'});
};

/** After a sync, outside any lock: a first clone can take minutes. */
export const fetchReposAndBroadcast = async (
	repoRoot: string,
	minIntervalMs?: number,
) => {
	broadcastFetchOutcomes(await fetchRepos({repoRoot, minIntervalMs}));
};

/** Tells clients to refetch commits, and the repos panel to refetch on any move or failure. */
const broadcastFetchOutcomes = (
	result: Awaited<ReturnType<typeof fetchRepos>>,
) => {
	if (isFail(result)) return;

	if (result.value.some(outcome => outcome.changed)) broadcastReposChanged();
	if (result.value.some(outcome => outcome.changed || !outcome.ok)) {
		broadcastGuiMessage({type: 'repos:fetched'});
	}
};

/** What one press of "fetch now" came to, in a line. */
const sendSocket = (socket: WebSocket, body: unknown) => {
	socket.send(JSON.stringify(body));
};

const sendGuiState = async (socket: WebSocket, repoRoot: string) => {
	const payload = slimStateResult(await getGuiState({repoRoot}));

	// Only a missing project shows the init screen; other failures are transient.
	if (isFail(payload) && payload.message === NO_PROJECT_MESSAGE) {
		return sendSocket(socket, {
			type: 'state:unavailable',
			payload: {
				message: payload.message,
				repoRoot,
				recentProjects: recentProjectViews(repoRoot),
			},
		});
	}

	return sendSocket(socket, {type: 'state', payload});
};

const sendStateAfterMutation = async (socket: WebSocket, repoRoot: string) => {
	const sendDerivedState = () =>
		sendSocket(socket, {
			type: 'state',
			payload: slimStateResult(deriveGuiState()),
		});

	if (getTimeTravelStatus().mode !== 'live') return sendDerivedState();

	const payload = await getGuiState({repoRoot});

	// This runs outside the time-travel lock, so a scrub can land during the boot
	// above. Re-check before publishing.
	if (getTimeTravelStatus().mode !== 'live') return sendDerivedState();

	return sendSocket(socket, {
		type: 'state',
		payload: slimStateResult(payload),
	});
};

const sendMutationResult = async (
	socket: WebSocket,
	repoRoot: string,
	onStateChanged: () => void,
	resultType: string,
	result: Result,
) => {
	sendSocket(socket, {
		type: resultType,
		payload: result,
	});

	if (isFail(result)) {
		return sendSocket(socket, {
			type: 'failed',
			payload: result.message,
		});
	}

	onStateChanged();

	void sendStateAfterMutation(socket, repoRoot);

	return;
};

export const setupWebsocket = (
	server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>,
	project: GuiProject,
	{
		onStateChanged,
		onSyncSettingsChanged,
		getPort,
	}: {
		onStateChanged: () => void;
		/** The autosync cadence changed: an armed timer holds the old interval and must be dropped. */
		onSyncSettingsChanged: () => void;
		getPort: () => number;
	},
) => {
	const wss = new WebSocketServer({
		server,
		path: '/ws',
		// Bounds memory before the API's own size checks run; attachments go over HTTP.
		maxPayload: MAX_SOCKET_FRAME_BYTES,
		// A handshake is exempt from the same-origin policy: without this, any open
		// page could send every message here, sync included.
		verifyClient: (info: {origin: string}) =>
			!isForeignOrigin(info.origin, getPort()),
	});

	wss.on('connection', socket => {
		registerGuiSocket(socket);

		socket.on('message', async raw => {
			const dispatchMessage = async (message: GuiMessage) => {
				const {type} = message;
				const repoRoot = project.repoRoot;

				if (type === 'project:open') {
					const result = resolveRecentProjectRoot(message.payload.root);

					sendSocket(socket, {type: 'project:open:result', payload: result});

					if (isFail(result)) return;

					project.repoRoot = result.value;
					return sendGuiState(socket, result.value);
				}

				// Echoed back rather than forwarded into the API: the client pairs
				// the timeline and commit replies by it.
				if (type === 'timeline:get') {
					const {requestId, ...query} = message.payload ?? {};
					return sendSocket(socket, {
						type: 'timeline',
						requestId,
						payload: await getEventTimeline({repoRoot, ...query}),
					});
				}

				// The text the board never draws, for the ticket that is open.
				if (type === 'issue:get') {
					const issueId = message.payload?.issueId;
					const state = deriveGuiState();
					const history = getIssueHistory(issueId);

					return sendSocket(socket, {
						type: 'issue',
						payload: isFail(state)
							? state
							: succeeded('Issue detail', {
									...issueDetail(state.value, issueId),
									history: isFail(history) ? [] : history.value,
							  }),
					});
				}

				// Wrapped with the issueId: several hover requests can be in flight.
				if (type === 'issue:preview:get') {
					const {issueId} = message.payload;
					const description = getIssueDescription(issueId);

					return sendSocket(socket, {
						type: 'issue:preview:result',
						payload: {
							issueId,
							result: isFail(description)
								? description
								: succeeded(
										'Issue preview',
										issuePreview(issueId, description.value),
								  ),
						},
					});
				}

				if (type === 'commits:get') {
					const {requestId, ...query} = message.payload ?? {};
					return sendSocket(socket, {
						type: 'commits',
						requestId,
						payload: withCommitAuthors(
							await getCommitTimeline({repoRoot, ...query}),
						),
					});
				}

				if (type === 'emails:get') {
					return sendSocket(socket, {
						type: 'emails',
						payload: await listContributorEmails({repoRoot}),
						// Alongside the list, so the panel offers addresses this
						// history actually contains rather than a box to type one into.
						suggestions: await suggestOwnEmails({repoRoot}),
					});
				}

				if (type === 'email:link' || type === 'email:unlink') {
					const act =
						type === 'email:link'
							? linkContributorEmail
							: unlinkContributorEmail;

					const result = await act({repoRoot, ...message.payload});

					// The list goes back first, so the panel can report what happened
					// and stop showing a stale answer beside a changed board.
					sendSocket(socket, {
						type: 'emails',
						payload: await listContributorEmails({repoRoot}),
						suggestions: await suggestOwnEmails({repoRoot}),
						lastAction: isFail(result)
							? {ok: false, message: result.message}
							: {ok: true, message: result.message},
					});

					// A link changes commit authorship, so it syncs and broadcasts like any write.
					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						`${type}:result`,
						result,
					);
				}

				if (type === 'me:stats:get') {
					return sendSocket(socket, {
						type: 'me:stats',
						payload: await getPersonalStats({repoRoot}),
					});
				}

				if (type === 'version:get') {
					return sendSocket(socket, {
						type: 'version',
						payload: await getUpdateInfo(EPIQ_VERSION),
					});
				}

				if (type === 'settings:get') {
					return sendSocket(socket, {
						type: 'settings',
						payload: readAutoSyncSettings(),
					});
				}

				if (type === 'settings:set') {
					const result = writeAutoSyncSettings({
						enabled: message.payload.autoSync,
						intervalMs: message.payload.autoSyncIntervalMs,
					});

					// Only on a change that landed. Re-arming after a refusal would
					// restart the clock on a cadence nobody altered.
					if (!isFail(result)) onSyncSettingsChanged();

					// The settings as they now are, even after a refused write.
					return sendSocket(socket, {
						type: 'settings',
						payload: isFail(result) ? readAutoSyncSettings() : result,
						lastAction: isFail(result)
							? {ok: false, message: result.message}
							: {ok: true, message: result.message},
					});
				}

				if (type === 'commit:inspect') {
					return sendSocket(socket, {
						type: 'commit:inspect:result',
						payload: await openCommitDiffInEditor({
							repoRoot,
							sha: message.payload.sha,
							repo: message.payload.repo,
						}),
					});
				}

				if (type === 'commit:diff:get') {
					const {sha, repo} = message.payload;

					// Wrapped with the sha: two surfaces can each have a diff in flight.
					return sendSocket(socket, {
						type: 'commit:diff:result',
						payload: {
							sha,
							repo,
							result: await getCommitDiff({repoRoot, sha, repo}),
						},
					});
				}

				if (type === 'repos:get') {
					// Own repo first, then the list read in the same turn it is sent, so
					// a change handled meanwhile cannot send a stale list last.
					const own = await readOwnRepo(repoRoot);

					return sendSocket(socket, {
						type: 'repos',
						payload: await listRepos({repoRoot}),
						// Beside the connected ones in the panel, and counted with them.
						own,
					});
				}

				// Stages a clone and previews it, writing nothing: not a mutation,
				// so a clone that takes minutes holds no lock.
				if (type === 'repo:preview') {
					const result = await connectRepo({
						repoRoot,
						...message.payload,
						previewOnly: true,
					});

					return sendSocket(socket, {
						type: 'repos',
						for: type,
						// Which preview this answers, refused or not.
						url: message.payload.url.trim(),
						payload: isFail(result) ? await listRepos({repoRoot}) : result,
						preview: isFail(result) ? null : result.value.preview ?? null,
						lastAction: {ok: !isFail(result), message: result.message},
					});
				}

				if (type === 'repo:preview:cancel') {
					cancelRepoConnect(message.payload);
					return sendSocket(socket, {
						type: 'repos',
						for: type,
						payload: await listRepos({repoRoot}),
						preview: null,
					});
				}

				if (type === 'repo:connect' || type === 'repo:disconnect') {
					const result =
						type === 'repo:connect'
							? await connectRepo({repoRoot, ...message.payload, confirm: true})
							: await disconnectRepo({repoRoot, ...message.payload});

					// The list either way, so a refused change leaves the panel
					// showing what is connected rather than what was turned down.
					sendSocket(socket, {
						type: 'repos',
						for: type,
						payload: isFail(result) ? await listRepos({repoRoot}) : result,
						preview: null,
						lastAction: {ok: !isFail(result), message: result.message},
					});

					// A refusal is the panel's to say, under the field: answered for
					// the mutation gate, and not raised again as a board error.
					if (isFail(result)) {
						return sendSocket(socket, {
							type: `${type}:result`,
							payload: result,
						});
					}

					// A rename moves no commit, so only other changes ask clients to refetch.
					if (
						!isFail(result) &&
						result.message !== REPO_UNCHANGED &&
						!result.message.startsWith(REPO_RENAMED)
					) {
						broadcastReposChanged();
					}

					// An event like any other: it queues a sync, so it reaches
					// every clone without anybody committing anything.
					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						`${type}:result`,
						result,
					);
				}

				if (type === 'issue:commits:get') {
					const {issueId} = message.payload;

					// Wrapped with the issueId: an older ticket's request may still be in flight.
					return sendSocket(socket, {
						type: 'issue:commits:result',
						payload: {
							issueId,
							// With bodies: the Code tab offers each commit's message
							// before its diff is opened.
							result: await withCommitBodies(
								repoRoot,
								withCommitAuthors(
									await getCommitsForRef({
										repoRoot,
										ref: nodeRef(issueId),
									}),
								),
							),
						},
					});
				}

				// The same ticket's commits as one diff, for the Diff tab's compacted
				// view. Wrapped with the issueId like its neighbours above.
				if (type === 'issue:squashed-diff:get') {
					const {issueId, asOfTime} = message.payload;

					return sendSocket(socket, {
						type: 'issue:squashed-diff:result',
						payload: {
							issueId,
							asOfTime: asOfTime ?? null,
							result: await getSquashedDiffForRef({
								repoRoot,
								ref: nodeRef(issueId),
								end: asOfTime,
							}),
						},
					});
				}

				if (type === 'issue:stats:get') {
					const {issueId, asOfTime} = message.payload;

					// Wrapped with the issueId, as above.
					return sendSocket(socket, {
						type: 'issue:stats:result',
						payload: {
							issueId,
							asOfTime: asOfTime ?? null,
							result: await getIssueStats({
								repoRoot,
								idOrRef: nodeRef(issueId),
								end: asOfTime,
							}),
						},
					});
				}

				// Unkeyed, unlike its neighbours above: the whole board is answered
				// in one reply, so there is no ticket for a late one to be about.
				if (type === 'diff-stats:get') {
					return sendSocket(socket, {
						type: 'diff-stats',
						payload: await getRefDiffTimeline({repoRoot}),
					});
				}

				if (type === 'swimlane:stats:get') {
					const {swimlaneId} = message.payload;

					// Wrapped with the swimlaneId: an older lane's request may still be in flight.
					return sendSocket(socket, {
						type: 'swimlane:stats:result',
						payload: {
							swimlaneId,
							result: await getSwimlaneStats({repoRoot, swimlaneId}),
						},
					});
				}

				if (type === 'goal:stats:get') {
					const {goalId, key, asOfTime} = message.payload;

					// The client's key comes back, so an answer to an older ask is
					// told from the latest.
					return sendSocket(socket, {
						type: 'goal:stats:result',
						payload: {
							goalId,
							key,
							result: await getGoalStats({
								repoRoot,
								goal: goalId,
								end: asOfTime,
							}),
						},
					});
				}

				if (type === 'goal:commits:get') {
					const {goalId, key, asOfTime} = message.payload;

					return sendSocket(socket, {
						type: 'goal:commits:result',
						payload: {
							goalId,
							key,
							result: await getGoalCommits({
								repoRoot,
								goal: goalId,
								end: asOfTime,
							}),
						},
					});
				}

				if (type === 'board:overview:get') {
					const {boardId} = message.payload;

					return sendSocket(socket, {
						type: 'board:overview:result',
						payload: {boardId, result: getBoardOverview({boardId})},
					});
				}

				if (type === 'time-travel:scrub') {
					const result = await checkoutStateAt({
						repoRoot,
						targetTime: message.payload.targetTime,
					});

					sendSocket(socket, {
						type: 'time-travel:result',
						payload: result,
					});

					if (isFail(result)) return;

					return broadcastDerivedState();
				}

				if (type === 'time-travel:checkout-event') {
					const result = await checkoutStateAtEvent({
						repoRoot,
						eventId: message.payload.eventId,
					});

					sendSocket(socket, {
						type: 'time-travel:result',
						payload: result,
					});

					if (isFail(result)) return;

					return broadcastDerivedState();
				}

				if (type === 'time-travel:live') {
					const result = await returnToLive({repoRoot});

					sendSocket(socket, {
						type: 'time-travel:result',
						payload: result,
					});

					if (isFail(result)) return;

					return broadcastDerivedState();
				}

				if (type === 'state:get') {
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'sync') {
					const result = await sync({repoRoot});

					sendSocket(socket, {
						type: 'sync:result',
						payload: result,
					});

					onStateChanged();

					// Not awaited: this handler runs under the board's lock, and the
					// fetch must not hold it.
					if (!isFail(result)) void fetchReposAndBroadcast(repoRoot);

					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:comment:add') {
					const result = await addIssueComment({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:comment:add:result',
						result,
					);
				}

				if (type === 'issue:comment:edit') {
					const result = await editIssueComment({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:comment:edit:result',
						result,
					);
				}

				if (type === 'issue:comment:delete') {
					const result = await deleteIssueComment({
						repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:comment:delete:result',
						payload: result,
					});

					if (isFail(result)) {
						return sendSocket(socket, {
							type: 'failed',
							payload: result.message,
						});
					}

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:edit:description') {
					const result = await editIssueDescription({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:edit:description:result',
						result,
					);
				}

				if (type === 'issue:edit:title') {
					const result = await editIssueTitle({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:edit:title:result',
						result,
					);
				}

				if (type === 'issue:tag:add') {
					const result = await addIssueTag({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:tag:add:result',
						result,
					);
				}

				if (type === 'issue:goal:set') {
					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:goal:set:result',
						await setIssueGoal({repoRoot, ...message.payload}),
					);
				}

				if (type === 'goal:create') {
					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'goal:create:result',
						await createGoal({repoRoot, ...message.payload}),
					);
				}

				if (type === 'goal:rename') {
					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'goal:rename:result',
						await renameGoal({repoRoot, ...message.payload}),
					);
				}

				if (type === 'goal:remove') {
					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'goal:remove:result',
						await removeGoal({repoRoot, ...message.payload}),
					);
				}

				if (type === 'issue:tag:remove') {
					const result = await removeIssueTag({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:tag:remove:result',
						result,
					);
				}

				if (type === 'contributor:remove') {
					const result = await tombstoneContributor({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'contributor:remove:result',
						result,
					);
				}

				if (type === 'tag:remove') {
					const result = await tombstoneTag({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'tag:remove:result',
						result,
					);
				}

				if (type === 'contributors:get') {
					// Echoes the board id: one socket outlives a board switch.
					return sendSocket(socket, {
						type: 'contributors',
						boardId: message.payload?.boardId,
						payload: await getBoardContributors({
							repoRoot,
							...message.payload,
						}),
					});
				}

				if (type === 'issue:assignee:add') {
					const result = await addIssueAssignee({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:assignee:add:result',
						result,
					);
				}

				if (type === 'issue:assignee:remove') {
					const result = await removeIssueAssignee({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:assignee:remove:result',
						result,
					);
				}

				if (type === 'issues:list') {
					return sendSocket(socket, {
						type: 'issues',
						payload: await listIssues({repoRoot}),
					});
				}

				if (type === 'issues:create') {
					const result = await createIssue({
						...message.payload,
						repoRoot,
					});

					sendSocket(socket, {
						type: 'issues:create:result',
						payload: result,
					});

					if (isFail(result)) {
						return broadcastGuiMessage({
							type: 'failed',
							payload: result.message,
						});
					}

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'board:create') {
					const result = await createBoard({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'board:create:result',
						result,
					);
				}

				if (type === 'board:edit:title') {
					const result = await editBoardTitle({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'board:edit:title:result',
						result,
					);
				}

				if (type === 'swimlane:create') {
					const result = await createSwimlane({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'swimlane:create:result',
						result,
					);
				}

				if (type === 'swimlane:edit:title') {
					const result = await editSwimlaneTitle({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'swimlane:edit:title:result',
						result,
					);
				}

				if (type === 'board:edit:description') {
					const result = await editBoardDescription({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'board:edit:description:result',
						result,
					);
				}

				if (type === 'swimlane:edit:description') {
					const result = await editSwimlaneDescription({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'swimlane:edit:description:result',
						result,
					);
				}

				if (type === 'swimlane:rule:set') {
					const result = await setSwimlaneRule({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'swimlane:rule:set:result',
						result,
					);
				}

				if (type === 'goal:edit:description') {
					const result = await editGoalDescription({
						repoRoot,
						goal: message.payload.goalId,
						description: message.payload.description,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'goal:edit:description:result',
						result,
					);
				}

				if (type === 'swimlane:delete') {
					const result = await deleteSwimlane({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'swimlane:delete:result',
						result,
					);
				}

				if (type === 'swimlane:move') {
					if (!message.payload.position) {
						return sendSocket(socket, {
							type: 'error',
							message: 'Missing move position',
						});
					}

					const result = await moveSwimlane({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'swimlane:move:result',
						result,
					);
				}

				if (type === 'issues:move') {
					if (!message.payload.position) {
						return sendSocket(socket, {
							type: 'error',
							message: 'Missing move position',
						});
					}

					const result = await moveIssue({
						...message.payload,
						repoRoot,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issues:move:result',
						result,
					);
				}

				if (type === 'issue:close') {
					const result = await closeIssue({
						repoRoot,
						issueId: message.payload.issueId,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:close:result',
						result,
					);
				}

				if (type === 'issue:reopen') {
					const result = await reopenIssue({
						repoRoot,
						issueId: message.payload.issueId,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:reopen:result',
						result,
					);
				}

				return sendSocket(socket, {
					type: 'error',
					message: 'Unknown message type',
				});
			};

			// A refused repo change is answered as one, with the list: the panel
			// waits on that answer, and a bare error never reaches it.
			let rawType: unknown;
			const refuse = async (message: string) => {
				if (
					rawType !== 'repo:connect' &&
					rawType !== 'repo:disconnect' &&
					rawType !== 'repo:preview'
				) {
					return sendSocket(socket, {type: 'error', message});
				}

				sendSocket(socket, {
					type: 'repos',
					for: rawType,
					payload: await listRepos({repoRoot: project.repoRoot}),
					preview: null,
					lastAction: {ok: false, message},
				});
				// The mutation gate counted it as sent; this is its answer.
				if (rawType !== 'repo:preview') {
					sendSocket(socket, {
						type: `${rawType}:result`,
						payload: failed(message),
					});
				}
			};

			try {
				const data: unknown = JSON.parse(raw.toString());
				rawType = (data as {type?: unknown} | null)?.type;
				const parsed = parseGuiMessage(data);

				if (!parsed.ok) return await refuse(parsed.error);

				const message = parsed.message;

				if (!MUTATING_MESSAGE_TYPES.has(message.type)) {
					return await dispatchMessage(message);
				}

				// The live check stays inside the lock; `runExclusive` is not re-entrant.
				return await runExclusive(async () => {
					if (getTimeTravelStatus().mode !== 'live') {
						return sendSocket(socket, {
							type: 'failed',
							payload: 'Read-only while viewing history',
						});
					}

					return dispatchMessage(message);
				});
			} catch (error) {
				return refuse(error instanceof Error ? error.message : String(error));
			}
		});
	});
};
