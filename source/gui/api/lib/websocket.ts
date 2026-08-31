import http from 'node:http';
import {WebSocket, WebSocketServer} from 'ws';
import {
	addIssueAssignee,
	getBoardContributors,
	tombstoneContributor,
	tombstoneTag,
	addIssueComment,
	addIssueTag,
	clearIssueEpic,
	closeIssue,
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
	getIssueHistory,
	listIssues,
	moveIssue,
	moveSwimlane,
	removeIssueAssignee,
	removeIssueTag,
	setIssueEpic,
	reopenIssue,
	sync,
} from '../../../mcp/epiq-api.js';
import {
	checkoutStateAt,
	checkoutStateAtEvent,
	getCommitDiff,
	getCommitsForRef,
	getCommitTimeline,
	getEventTimeline,
	getTimeTravelStatus,
	openCommitDiffInEditor,
	returnToLive,
	runExclusive,
} from '../../../mcp/epiq-time-travel.js';
import {isFail, Result, succeeded} from '../../../lib/model/result-types.js';
import {NO_PROJECT_MESSAGE} from '../../../lib/storage/paths.js';
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
import {issueDetail, slimStateResult} from './slim-state.js';

// Derives rather than boots, so a live re-materialize can't stomp a checkout.
const broadcastDerivedState = () => {
	broadcastGuiMessage({
		type: 'state',
		payload: slimStateResult(deriveGuiState()),
	});
};

const sendSocket = (socket: WebSocket, body: unknown) => {
	socket.send(JSON.stringify(body));
};

const sendGuiState = async (socket: WebSocket, repoRoot: string) => {
	const payload = slimStateResult(await getGuiState({repoRoot}));

	// Only a missing project puts the client on the init screen. Every other
	// failure — a git lock a concurrent TUI is holding, a half-written log — is
	// transient, and the board it is already showing is better than a wrong
	// diagnosis.
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
		getPort,
	}: {onStateChanged: () => void; getPort: () => number},
) => {
	const wss = new WebSocketServer({
		server,
		path: '/ws',
		// A handshake is not bound by the same-origin policy, so without this any
		// page the user has open reaches every message below — including `sync`,
		// which pushes to the shared remote.
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

				if (type === 'commits:get') {
					const {requestId, ...query} = message.payload ?? {};
					return sendSocket(socket, {
						type: 'commits',
						requestId,
						payload: await getCommitTimeline({repoRoot, ...query}),
					});
				}

				if (type === 'commit:inspect') {
					return sendSocket(socket, {
						type: 'commit:inspect:result',
						payload: await openCommitDiffInEditor({
							repoRoot,
							sha: message.payload.sha,
						}),
					});
				}

				if (type === 'commit:diff:get') {
					const {sha} = message.payload;

					// Wrapped with the sha rather than sending the Result bare: two
					// surfaces can each have a diff request in flight for a different
					// commit (the scrubber's dot and the ticket tab's commit list), and
					// a failed Result carries no sha of its own to tell them apart.
					return sendSocket(socket, {
						type: 'commit:diff:result',
						payload: {sha, result: await getCommitDiff({repoRoot, sha})},
					});
				}

				if (type === 'issue:commits:get') {
					const {issueId} = message.payload;

					// Wrapped with the issueId for the same reason commit:diff:result is:
					// switching tickets while the Code tab stays open can leave an older
					// ticket's request in flight, and the client needs to tell whose
					// reply this is before applying it.
					return sendSocket(socket, {
						type: 'issue:commits:result',
						payload: {
							issueId,
							result: await getCommitsForRef({
								repoRoot,
								ref: nodeRef(issueId),
							}),
						},
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

				if (type === 'issue:epic:set') {
					const result = await setIssueEpic({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:epic:set:result',
						result,
					);
				}

				if (type === 'issue:epic:clear') {
					const result = await clearIssueEpic({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'issue:epic:clear:result',
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
					return sendSocket(socket, {
						type: 'contributors',
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

			try {
				const parsed = parseGuiMessage(JSON.parse(raw.toString()));

				if (!parsed.ok) {
					return sendSocket(socket, {type: 'error', message: parsed.error});
				}

				const message = parsed.message;

				if (!MUTATING_MESSAGE_TYPES.has(message.type)) {
					return await dispatchMessage(message);
				}

				// The live check must stay *inside* the lock; checking then awaiting is
				// check-then-act. `runExclusive` is not re-entrant, so nothing reached
				// from here may take it again.
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
				return sendSocket(socket, {
					type: 'error',
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});
	});
};
