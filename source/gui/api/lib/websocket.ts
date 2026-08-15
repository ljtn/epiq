import http from 'node:http';
import {WebSocket, WebSocketServer} from 'ws';
import {
	addIssueAssignee,
	getBoardContributors,
	tombstoneContributor,
	addIssueComment,
	addIssueTag,
	closeIssue,
	createIssue,
	deleteIssueComment,
	deriveGuiState,
	editIssueDescription,
	editIssueTitle,
	getGuiState,
	listIssues,
	moveIssue,
	removeIssueAssignee,
	removeIssueTag,
	reopenIssue,
	sync,
} from '../../../mcp/epiq-api.js';
import {
	checkoutStateAt,
	getCommitTimeline,
	getEventTimeline,
	getTimeTravelStatus,
	openCommitDiffInEditor,
	returnToLive,
	runExclusive,
} from '../../../mcp/epiq-time-travel.js';
import {isFail, Result} from '../../../lib/model/result-types.js';
import {
	broadcastGuiMessage,
	registerGuiSocket,
} from '../../client/lib/gui-broadcast.js';
import {GuiMessage} from './websocket.model.js';

const MUTATING_MESSAGE_TYPES = new Set<GuiMessage['type']>([
	'sync',
	'issues:create',
	'issues:move',
	'issue:close',
	'issue:reopen',
	'issue:edit:title',
	'issue:edit:description',
	'issue:tag:add',
	'issue:tag:remove',
	'contributor:remove',
	'issue:assignee:add',
	'issue:assignee:remove',
	'issue:comment:add',
	'issue:comment:delete',
]);

// Derives rather than boots, so a live re-materialize can't stomp a checkout.
const broadcastDerivedState = () => {
	const result = deriveGuiState();

	broadcastGuiMessage({
		type: 'state',
		payload: result,
	});
};

const sendSocket = (socket: WebSocket, body: unknown) => {
	socket.send(JSON.stringify(body));
};

const sendGuiState = async (socket: WebSocket, repoRoot: string) =>
	sendSocket(socket, {
		type: 'state',
		payload: await getGuiState({repoRoot}),
	});

const sendStateAfterMutation = async (socket: WebSocket, repoRoot: string) => {
	const sendDerivedState = () =>
		sendSocket(socket, {
			type: 'state',
			payload: deriveGuiState(),
		});

	if (getTimeTravelStatus().mode !== 'live') return sendDerivedState();

	const payload = await getGuiState({repoRoot});

	// This runs outside the time-travel lock, so a scrub can land during the boot
	// above. Re-check before publishing.
	if (getTimeTravelStatus().mode !== 'live') return sendDerivedState();

	return sendSocket(socket, {
		type: 'state',
		payload,
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
	repoRoot: string,
	{onStateChanged}: {onStateChanged: () => void},
) => {
	const wss = new WebSocketServer({
		server,
		path: '/ws',
	});

	wss.on('connection', socket => {
		registerGuiSocket(socket);

		socket.on('message', async raw => {
			const dispatchMessage = async (message: GuiMessage) => {
				const {type} = message;

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

					broadcastGuiMessage({
						type: 'issue:created',
						payload: result.value,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
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
					if (!message.payload.issueId) {
						return sendSocket(socket, {
							type: 'error',
							message: 'Missing issueId',
						});
					}

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
					if (!message.payload.issueId) {
						return sendSocket(socket, {
							type: 'error',
							message: 'Missing issueId',
						});
					}

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
				const message = JSON.parse(raw.toString()) as GuiMessage;

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
