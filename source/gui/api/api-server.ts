import {readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {failed, Result, succeeded} from '../../lib/model/result-types.js';
import {getGuiState} from '../../mcp/epiq-api.js';
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

const listen = async (server: http.Server) =>
	new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off('listening', onListening);
			reject(error);
		};

		const onListening = () => {
			server.off('error', onError);
			resolve();
		};

		server.once('error', onError);
		server.once('listening', onListening);
		server.listen(0, '127.0.0.1');
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
		url: `http://127.0.0.1:${address.port}${
			input.boardId ? `/board/${input.boardId}` : ''
		}`,
		server,
	});
};
