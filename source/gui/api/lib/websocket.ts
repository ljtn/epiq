import {WebSocket, WebSocketServer} from 'ws';
import http from 'node:http';
import {GuiMessage} from './websocket.model';
import {
	addIssueAssignee,
	addIssueTag,
	closeIssue,
	createIssue,
	editIssueDescription,
	editIssueTitle,
	getGuiState,
	listIssues,
	moveIssue,
	removeIssueAssignee,
	removeIssueTag,
	reopenIssue,
	sync,
} from '../../../mcp/epiq-api';
import {registerGuiSocket} from '../../client/lib/gui-broadcast';

const sendGuiState = async (socket: WebSocket, repoRoot: string) =>
	sendSocket(socket, {
		type: 'state',
		payload: await getGuiState({repoRoot}),
	});

const sendSocket = (socket: WebSocket, body: unknown) => {
	socket.send(JSON.stringify(body));
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

				if (type === 'state:get') {
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'sync') {
					const result = await sync({repoRoot: repoRoot});

					sendSocket(socket, {
						type: 'sync:result',
						payload: result,
					});

					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:edit:description') {
					const result = await editIssueDescription({
						repoRoot: repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:edit:description:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:edit:title') {
					const result = await editIssueTitle({
						repoRoot: repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:edit:title:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:tag:add') {
					const result = await addIssueTag({
						repoRoot: repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:tag:add:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:tag:remove') {
					const result = await removeIssueTag({
						repoRoot: repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:tag:remove:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:assignee:add') {
					const result = await addIssueAssignee({
						repoRoot: repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:assignee:add:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:assignee:remove') {
					const result = await removeIssueAssignee({
						repoRoot: repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:assignee:remove:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issues:list') {
					return sendSocket(socket, {
						type: 'issues',
						payload: await listIssues({repoRoot: repoRoot}),
					});
				}

				if (type === 'issues:create') {
					const result = await createIssue({
						...message.payload,
						repoRoot: repoRoot,
					});

					sendSocket(socket, {
						type: 'issues:create:result',
						payload: result,
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
						repoRoot: repoRoot,
					});

					sendSocket(socket, {
						type: 'issues:move:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:close') {
					if (!message.payload.issueId) {
						return sendSocket(socket, {
							type: 'error',
							message: 'Missing issueId',
						});
					}

					const result = await closeIssue({
						repoRoot: repoRoot,
						issueId: message.payload.issueId,
					});

					console.log('close result', result);

					sendSocket(socket, {
						type: 'issue:close:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
				}

				if (type === 'issue:reopen') {
					if (!message.payload.issueId) {
						return sendSocket(socket, {
							type: 'error',
							message: 'Missing issueId',
						});
					}

					const result = await reopenIssue({
						repoRoot: repoRoot,
						issueId: message.payload.issueId,
					});

					console.log('reopen result', result);

					sendSocket(socket, {
						type: 'issue:reopen:result',
						payload: result,
					});

					onStateChanged();
					return sendGuiState(socket, repoRoot);
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
