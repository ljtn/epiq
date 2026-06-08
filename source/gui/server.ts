import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';
import {
	addIssueAssignee,
	addIssueTag,
	createIssue,
	editIssueDescription,
	editIssueTitle,
	getGuiState,
	listIssues,
	moveIssue,
	removeIssueAssignee,
	removeIssueTag,
	sync,
} from '../mcp/epiq-api.js';
import {MovePosition} from '../lib/event/event.model.js';
import {failed, Result, succeeded} from '../lib/model/result-types.js';
import {registerGuiSocket} from './client/lib/gui-broadcast.js';

const distRoot = path.dirname(fileURLToPath(import.meta.url));

const guiRoot =
	process.env['IS_LOCAL'] === 'true'
		? path.resolve(process.cwd(), 'dist/gui')
		: path.join(distRoot, 'gui');

type GuiMessage =
	| {type: 'state:get'}
	| {type: 'issues:list'}
	| {type: 'issues:create'; payload: {title: string; parentId: string}}
	| {type: 'sync'}
	| {type: 'issue:edit:title'; payload: {issueId: string; title: string}}
	| {
			type: 'issue:edit:description';
			payload: {issueId: string; description: string};
	  }
	| {type: 'issue:tag:add'; payload: {issueId: string; tagName: string}}
	| {type: 'issue:tag:remove'; payload: {issueId: string; tagId: string}}
	| {
			type: 'issue:assignee:add';
			payload: {issueId: string; assigneeName: string};
	  }
	| {
			type: 'issue:assignee:remove';
			payload: {issueId: string; assigneeId: string};
	  }
	| {
			type: 'issues:move';
			payload: {
				issueId: string;
				parentId: string;
				position?: MovePosition;
			};
	  };

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, {'content-type': 'application/json'});
	res.end(JSON.stringify(body));
};

const sendSocket = (socket: WebSocket, body: unknown) => {
	socket.send(JSON.stringify(body));
};

const getContentType = (filePath: string) => {
	if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
	if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
	if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
	if (filePath.endsWith('.ico')) return 'image/x-icon';

	return 'application/octet-stream';
};

const serveStatic = async (urlPathname: string, res: http.ServerResponse) => {
	const safePath =
		urlPathname === '/'
			? 'index.html'
			: decodeURIComponent(urlPathname).replace(/^\/+/, '');

	const resolvedGuiRoot = path.resolve(guiRoot);
	const filePath = path.resolve(resolvedGuiRoot, safePath);
	const relativePath = path.relative(resolvedGuiRoot, filePath);

	if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		return sendJson(res, 403, {
			isError: true,
			message: 'Forbidden',
		});
	}

	try {
		const file = await readFile(filePath);

		res.writeHead(200, {
			'content-type': getContentType(filePath),
		});

		return res.end(file);
	} catch {
		return sendJson(res, 404, {
			isError: true,
			message: `Not found: ${safePath}`,
		});
	}
};

const getBoardIdFromPath = (pathname: string): string | undefined => {
	const parts = pathname.split('/');

	if (parts.length !== 3) return undefined;
	if (parts[1] !== 'board') return undefined;

	return parts[2];
};

const sendGuiState = async (
	socket: WebSocket,
	repoRoot: string,
	boardId: string,
) =>
	sendSocket(socket, {
		type: 'state',
		payload: await getGuiState({repoRoot}, boardId),
	});

export const startGuiServer = async (input: {
	repoRoot: string;
	boardId: string;
}): Promise<Result<{url: string; server: http.Server}>> => {
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const boardId = getBoardIdFromPath(url.pathname) ?? input.boardId;

		if (url.pathname === '/api/state') {
			return sendJson(
				res,
				200,
				await getGuiState({repoRoot: input.repoRoot}, boardId),
			);
		}

		if (url.pathname.startsWith('/board/')) {
			return serveStatic('/', res);
		}

		return serveStatic(url.pathname, res);
	});

	const wss = new WebSocketServer({
		server,
		path: '/ws',
	});

	wss.on('connection', (socket, req) => {
		registerGuiSocket(socket);
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const boardId = url.searchParams.get('boardId') ?? input.boardId;

		socket.on('message', async raw => {
			try {
				const message = JSON.parse(raw.toString()) as GuiMessage;
				const {type} = message;

				if (type === 'state:get') {
					return sendGuiState(socket, input.repoRoot, boardId);
				}

				if (type === 'sync') {
					const result = await sync({repoRoot: input.repoRoot});

					sendSocket(socket, {
						type: 'sync:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
				}

				if (type === 'issue:edit:description') {
					const result = await editIssueDescription({
						repoRoot: input.repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:edit:description:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
				}

				if (type === 'issue:edit:title') {
					const result = await editIssueTitle({
						repoRoot: input.repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:edit:title:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
				}

				if (type === 'issue:tag:add') {
					const result = await addIssueTag({
						repoRoot: input.repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:tag:add:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
				}

				if (type === 'issue:tag:remove') {
					const result = await removeIssueTag({
						repoRoot: input.repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:tag:remove:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
				}

				if (type === 'issue:assignee:add') {
					const result = await addIssueAssignee({
						repoRoot: input.repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:assignee:add:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
				}

				if (type === 'issue:assignee:remove') {
					const result = await removeIssueAssignee({
						repoRoot: input.repoRoot,
						...message.payload,
					});

					sendSocket(socket, {
						type: 'issue:assignee:remove:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
				}

				if (type === 'issues:list') {
					return sendSocket(socket, {
						type: 'issues',
						payload: await listIssues({repoRoot: input.repoRoot}),
					});
				}

				if (type === 'issues:create') {
					const result = await createIssue({
						...message.payload,
						repoRoot: input.repoRoot,
					});

					sendSocket(socket, {
						type: 'issues:create:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
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
						repoRoot: input.repoRoot,
					});

					sendSocket(socket, {
						type: 'issues:move:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot, boardId);
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

	await new Promise<void>(resolve => {
		server.listen(0, '127.0.0.1', resolve);
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		return failed('Unable to resolve GUI server address');
	}

	return succeeded('Started GUI server', {
		url: `http://127.0.0.1:${address.port}${
			input.boardId ? `/board/${input.boardId}` : ''
		}`,
		server,
	});
};
