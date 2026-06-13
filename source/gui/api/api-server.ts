import {readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {failed, Result, succeeded} from '../../lib/model/result-types.js';
import {
	addIssueComment,
	deleteIssueComment,
	getGuiState,
} from '../../mcp/epiq-api.js';
import {startGuiAutoSync} from './lib/api-autosync.js';
import {setupWebsocket} from './lib/websocket.js';

const distRoot = path.dirname(fileURLToPath(import.meta.url));

const guiRoot =
	process.env['IS_LOCAL'] === 'true'
		? path.resolve(process.cwd(), 'dist/gui')
		: path.join(distRoot, 'gui');

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, {'content-type': 'application/json'});
	res.end(JSON.stringify(body));
};

const readJsonBody = async <T>(req: http.IncomingMessage): Promise<T> =>
	new Promise((resolve, reject) => {
		let body = '';

		req.on('data', chunk => {
			body += chunk;
		});

		req.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : ({} as T));
			} catch {
				reject(new Error('Invalid JSON body'));
			}
		});

		req.on('error', reject);
	});

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

const listen = async (
	server: http.Server,
	preferredPort = 3710,
): Promise<number> =>
	new Promise((resolve, reject) => {
		const tryListen = (port: number) => {
			const onError = (error: NodeJS.ErrnoException) => {
				server.off('listening', onListening);

				if (error.code === 'EADDRINUSE' && port === preferredPort) {
					server.removeListener('error', onError);
					tryListen(0);
					return;
				}

				reject(error);
			};

			const onListening = () => {
				server.off('error', onError);

				const address = server.address();
				if (!address || typeof address === 'string') {
					reject(new Error('Unable to resolve address'));
					return;
				}

				resolve(address.port);
			};

			server.once('error', onError);
			server.once('listening', onListening);

			server.listen(port, '127.0.0.1');
		};

		tryListen(preferredPort);
	});

export const startGuiServer = async (input: {
	repoRoot: string;
	boardId: string;
}): Promise<Result<{url: string; server: http.Server}>> => {
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');

		if (url.pathname === '/api/state') {
			return sendJson(res, 200, await getGuiState({repoRoot: input.repoRoot}));
		}

		if (req.method === 'POST' && url.pathname === '/api/comments') {
			try {
				const body = await readJsonBody<{
					issueId?: string;
					body?: string;
				}>(req);

				if (!body.issueId || !body.body?.trim()) {
					return sendJson(res, 400, {
						isError: true,
						message: 'Missing issueId or body',
					});
				}

				const result = await addIssueComment({
					repoRoot: input.repoRoot,
					issueId: body.issueId,
					body: body.body,
				});

				if ('isError' in result && result.isError) {
					return sendJson(res, 400, result);
				}

				return sendJson(
					res,
					200,
					await getGuiState({repoRoot: input.repoRoot}),
				);
			} catch (error) {
				return sendJson(res, 400, {
					isError: true,
					message:
						error instanceof Error ? error.message : 'Unable to add comment',
				});
			}
		}

		if (req.method === 'DELETE' && url.pathname.startsWith('/api/comments/')) {
			const commentId = decodeURIComponent(
				url.pathname.replace('/api/comments/', ''),
			);

			if (!commentId) {
				return sendJson(res, 400, {
					isError: true,
					message: 'Missing comment id',
				});
			}

			const result = await deleteIssueComment({
				repoRoot: input.repoRoot,
				commentId,
			});

			if ('isError' in result && result.isError) {
				return sendJson(res, 400, result);
			}

			return sendJson(res, 200, await getGuiState({repoRoot: input.repoRoot}));
		}

		if (url.pathname.startsWith('/board/')) {
			return serveStatic('/', res);
		}

		return serveStatic(url.pathname, res);
	});

	try {
		await listen(server);
	} catch (error) {
		return failed(
			error instanceof Error
				? `Unable to start GUI server: ${error.message}`
				: `Unable to start GUI server: ${String(error)}`,
		);
	}

	const guiAutoSync = startGuiAutoSync({
		repoRoot: input.repoRoot,
	});

	setupWebsocket(server, input.repoRoot, {
		onStateChanged: () => guiAutoSync.scheduleSync(),
	});

	server.on('close', guiAutoSync.dispose);

	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		return failed('Unable to resolve GUI server address');
	}

	return succeeded('Started GUI server', {
		url: `http://epiq.localhost:${address.port}${
			input.boardId ? `/board/${input.boardId}` : ''
		}`,
		server,
	});
};
