import http from 'node:http';
import {WebSocket, WebSocketServer} from 'ws';
import {
	addIssueAssignee,
	getBoardContributors,
	redactContributor,
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
} from '../../../mcp/epiq-time-travel.js';
import {isFail, Result} from '../../../lib/model/result-types.js';
import {
	broadcastGuiMessage,
	registerGuiSocket,
} from '../../client/lib/gui-broadcast.js';
import {GuiMessage} from './websocket.model.js';

// Message types that mutate board state. Rejected while a time-travel checkout
// is active, since the shared state singleton means an edit would corrupt the
// historical view every connected client is currently looking at.
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
	'contributor:redact',
	'issue:assignee:add',
	'issue:assignee:remove',
	'issue:comment:add',
	'issue:comment:delete',
]);

// Pushes the current (possibly historical) state to every connected client,
// bypassing `getGuiState`'s `boot()` so a live re-materialize doesn't stomp an
// active time-travel checkout.
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

	// Broadcast refresh to everyone, but do not block the requester UX.
	void sendGuiState(socket, repoRoot);

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
			try {
				const message = JSON.parse(raw.toString()) as GuiMessage;
				const {type} = message;

				if (
					MUTATING_MESSAGE_TYPES.has(type) &&
					getTimeTravelStatus().mode !== 'live'
				) {
					return sendSocket(socket, {
						type: 'failed',
						payload: 'Read-only while viewing history',
					});
				}

				if (type === 'timeline:get') {
					return sendSocket(socket, {
						type: 'timeline',
						payload: await getEventTimeline({repoRoot, ...message.payload}),
					});
				}

				if (type === 'commits:get') {
					return sendSocket(socket, {
						type: 'commits',
						payload: await getCommitTimeline({repoRoot, ...message.payload}),
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

				if (type === 'contributor:redact') {
					const result = await redactContributor({
						repoRoot,
						...message.payload,
					});

					return sendMutationResult(
						socket,
						repoRoot,
						onStateChanged,
						'contributor:redact:result',
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
			} catch (error) {
				return sendSocket(socket, {
					type: 'error',
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});
	});
};
