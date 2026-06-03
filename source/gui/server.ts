import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';
import {
	createIssue,
	getGuiState,
	listIssues,
	moveIssue,
	sync,
} from '../mcp/epiq-api.js';
import {failed, Result, succeeded} from '../lib/model/result-types.js';
import {MovePosition} from '../lib/event/event.model.js';
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
		urlPathname === '/' ? 'index.html' : urlPathname.replace(/^\/+/, '');

	const filePath = path.resolve(path.join(guiRoot, safePath));
	const resolvedGuiRoot = path.resolve(guiRoot);

	if (!filePath.startsWith(resolvedGuiRoot)) {
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

		res.end(file);
	} catch {
		return sendJson(res, 404, {
			isError: true,
			message: `Not found: ${safePath}`,
		});
	}
};

const sendGuiState = async (socket: WebSocket, repoRoot: string) =>
	sendSocket(socket, {
		type: 'state',
		payload: await getGuiState({repoRoot}),
	});

export const startGuiServer = async (input: {
	repoRoot: string;
}): Promise<Result<{url: string; server: http.Server}>> => {
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');

		if (url.pathname === '/api/state') {
			return sendJson(res, 200, await getGuiState({repoRoot: input.repoRoot}));
		}

		return serveStatic(url.pathname, res);
	});

	const wss = new WebSocketServer({
		server,
		path: '/ws',
	});

	wss.on('connection', socket => {
		registerGuiSocket(socket);

		socket.on('message', async raw => {
			try {
				const message = JSON.parse(raw.toString()) as GuiMessage;

				if (message.type === 'state:get') {
					return sendGuiState(socket, input.repoRoot);
				}

				if (message.type === 'issues:list') {
					return sendSocket(socket, {
						type: 'issues',
						payload: await listIssues({repoRoot: input.repoRoot}),
					});
				}

				if (message.type === 'issues:create') {
					const result = await createIssue({
						...message.payload,
						repoRoot: input.repoRoot,
					});

					sendSocket(socket, {
						type: 'issues:create:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot);
				}

				if (message.type === 'sync') {
					const result = await sync({repoRoot: input.repoRoot});

					sendSocket(socket, {
						type: 'sync:result',
						payload: result,
					});

					return sendGuiState(socket, input.repoRoot);
				}

				if (message.type === 'issues:move') {
					console.log('[gui:move:start]', message.payload);

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

					console.log('[gui:move:result]', result);

					sendSocket(socket, {
						type: 'issues:move:result',
						payload: result,
					});

					await sendGuiState(socket, input.repoRoot);

					return;
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
		url: `http://127.0.0.1:${address.port}`,
		server,
	});
};
