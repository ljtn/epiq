import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setVirtualNodesEnabled} from '../../lib/virtual-nodes/virtual-nodes.js';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {
	addIssueAttachment,
	addIssueComment,
	deleteIssueAttachment,
	deleteIssueComment,
	getAttachmentBlob,
	getGuiState,
} from '../../mcp/epiq-api.js';
import {getTimeTravelStatus, runExclusive} from '../../mcp/epiq-time-travel.js';
import {EPIQ_VERSION} from '../../version.js';
import {
	canonicalRepoRoot,
	GuiInstance,
	INSTANCE_APP,
	INSTANCE_PATH,
	PREFERRED_GUI_PORT,
} from './instance.js';
import {startGuiAutoSync} from './lib/api-autosync.js';
import {createLogPublisher, startGuiLogWatch} from './lib/api-log-watch.js';
import {refuseCrossSiteRequest} from './lib/origin-guard.js';
import {GuiProject} from './lib/gui-project.js';
import {fetchReposAndBroadcast, setupWebsocket} from './lib/websocket.js';

const distRoot = path.dirname(fileURLToPath(import.meta.url));

const guiRoot =
	process.env['IS_LOCAL'] === 'true'
		? path.resolve(process.cwd(), 'dist/gui')
		: path.join(distRoot, 'gui');

// Dynamic import since `node:sea` doesn't exist on Node < 20.12.
let seaModule: typeof import('node:sea') | null | undefined;

const getSeaModule = async () => {
	if (seaModule === undefined) {
		seaModule = await import('node:sea').catch(() => null);
	}

	return seaModule?.isSea() ? seaModule : null;
};

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, {'content-type': 'application/json'});
	res.end(JSON.stringify(body));
};

const sendReadOnlyWhileTimeTravelingError = (res: http.ServerResponse) =>
	sendJson(res, 409, {
		isError: true,
		message: 'Read-only while viewing history',
	});

/**
 * The live check stays inside the lock, which isn't re-entrant. Read bodies first,
 * or a slow upload holds this server-wide lock and stalls scrubbing.
 */
const runMutation = <T>(res: http.ServerResponse, mutate: () => Promise<T>) =>
	runExclusive(async () => {
		if (getTimeTravelStatus().mode !== 'live') {
			return sendReadOnlyWhileTimeTravelingError(res);
		}

		return mutate();
	});

const readJsonBody = async <T>(
	req: http.IncomingMessage,
	maxBytes = 1024 * 1024,
): Promise<T> =>
	new Promise((resolve, reject) => {
		// Decoded once at the end, so a character split across two reads survives.
		const chunks: Buffer[] = [];
		let received = 0;

		req.on('data', (chunk: Buffer) => {
			received += chunk.length;

			if (received > maxBytes) {
				req.destroy();
				reject(new Error('Request body too large'));
				return;
			}

			chunks.push(chunk);
		});

		req.on('end', () => {
			const body = Buffer.concat(chunks).toString('utf8');

			try {
				resolve(body ? JSON.parse(body) : ({} as T));
			} catch {
				reject(new Error('Invalid JSON body'));
			}
		});

		req.on('error', reject);
	});

/** Base64 inflates the 500 KB blob cap by ~4/3, plus headroom for the envelope. */
const ATTACHMENT_BODY_MAX_BYTES = 2 * 1024 * 1024;

const MEDIA_CONTENT_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
};

const getContentType = (filePath: string) => {
	if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
	if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
	if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
	if (filePath.endsWith('.ico')) return 'image/x-icon';
	if (filePath.endsWith('.woff2')) return 'font/woff2';

	return 'application/octet-stream';
};

// ETags by path, trusted while the file's size and mtime hold; under SEA the
// assets are fixed, so a tag stands for the process's lifetime.
const etagCache = new Map<string, {stamp: string; etag: string}>();

const etagOf = (bytes: Buffer): string =>
	`"${createHash('sha1').update(bytes).digest('base64url')}"`;

const fileStamp = async (filePath: string): Promise<string | null> => {
	try {
		const {size, mtimeMs} = await stat(filePath);

		return `${size}:${mtimeMs}`;
	} catch {
		return null;
	}
};

// `decodeURIComponent` throws on a stray `%`; a malformed path is a 404.
export const decodePath = (urlPathname: string): string | null => {
	try {
		return decodeURIComponent(urlPathname);
	} catch {
		return null;
	}
};

const serveStatic = async (
	urlPathname: string,
	req: http.IncomingMessage,
	res: http.ServerResponse,
) => {
	const decoded = urlPathname === '/' ? '/index.html' : decodePath(urlPathname);

	if (decoded === null) {
		return sendJson(res, 404, {
			isError: true,
			message: 'Not found',
		});
	}

	const safePath = decoded.replace(/^\/+/, '');

	const resolvedGuiRoot = path.resolve(guiRoot);
	const filePath = path.resolve(resolvedGuiRoot, safePath);
	const relativePath = path.relative(resolvedGuiRoot, filePath);

	if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		return sendJson(res, 403, {
			isError: true,
			message: 'Forbidden',
		});
	}

	const sea = await getSeaModule();

	// SEA assets never move; a file on disk does, so its stamp is what says the
	// remembered tag is still that file's.
	const stamp = sea ? 'sea' : await fileStamp(filePath);
	const remembered = stamp === null ? undefined : etagCache.get(relativePath);
	const known =
		remembered && remembered.stamp === stamp ? remembered.etag : null;

	// Answered before the file is read, which is the point: an unchanged bundle
	// costs a stat rather than a megabyte.
	if (known && req.headers['if-none-match'] === known) {
		res.writeHead(304, {etag: known, 'cache-control': 'no-cache'});

		return res.end();
	}

	try {
		const file = sea
			? Buffer.from(sea.getAsset(`gui/${relativePath}`))
			: await readFile(filePath);

		const etag = known ?? etagOf(file);
		if (stamp !== null) etagCache.set(relativePath, {stamp, etag});

		res.writeHead(200, {
			'content-type': getContentType(filePath),
			etag,
			// Revalidate, never expire: `main.js` and `index.html` keep their names
			// across builds.
			'cache-control': 'no-cache',
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
	preferredPort = PREFERRED_GUI_PORT,
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
	// Nothing this server sends reads virtual fields, the costliest part of replay.
	setVirtualNodesEnabled(false);

	// Known only after `listen`, and the handler below closes over it.
	let boundPort = 0;

	// Read at each request rather than captured: `project:open` moves it.
	const project: GuiProject = {repoRoot: input.repoRoot};

	const server = http.createServer((req, res) => {
		// Nothing below may throw: an unhandled rejection here ends the process.
		void handleRequest(req, res).catch(error => {
			logger.error(
				`[gui] ${req.method} ${req.url}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);

			if (res.headersSent) return res.end();

			return sendJson(res, 500, {
				isError: true,
				message: 'Internal error',
			});
		});
	});

	async function handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	) {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');

		const refusal = refuseCrossSiteRequest(
			{
				method: req.method,
				origin: req.headers.origin,
				contentType: req.headers['content-type'],
			},
			boundPort,
		);

		if (refusal) {
			return sendJson(res, refusal.status, {
				isError: true,
				message: refusal.message,
			});
		}

		// Answered before reading the board, so a probe from another epiq is cheap.
		if (req.method === 'GET' && url.pathname === INSTANCE_PATH) {
			return sendJson(res, 200, {
				app: INSTANCE_APP,
				repoRoot: canonicalRepoRoot(project.repoRoot),
				version: EPIQ_VERSION,
				pid: process.pid,
			} satisfies GuiInstance);
		}

		if (url.pathname === '/api/state') {
			return sendJson(
				res,
				200,
				await getGuiState({repoRoot: project.repoRoot}),
			);
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

				const issueId = body.issueId;
				const commentBody = body.body;

				return await runMutation(res, async () => {
					const result = await addIssueComment({
						repoRoot: project.repoRoot,
						issueId,
						body: commentBody,
					});

					if (isFail(result)) {
						return sendJson(res, 400, {
							isError: true,
							message: result.message,
						});
					}

					return sendJson(
						res,
						200,
						await getGuiState({repoRoot: project.repoRoot}),
					);
				});
			} catch (error) {
				return sendJson(res, 400, {
					isError: true,
					message:
						error instanceof Error ? error.message : 'Unable to add comment',
				});
			}
		}

		if (req.method === 'POST' && url.pathname === '/api/attachments') {
			try {
				const body = await readJsonBody<{
					issueId?: string;
					name?: string;
					dataBase64?: string;
				}>(req, ATTACHMENT_BODY_MAX_BYTES);

				if (!body.issueId || !body.dataBase64) {
					return sendJson(res, 400, {
						isError: true,
						message: 'Missing issueId or dataBase64',
					});
				}

				const issueId = body.issueId;
				const dataBase64 = body.dataBase64;
				const name = body.name ?? '';

				return await runMutation(res, async () => {
					const result = await addIssueAttachment({
						repoRoot: project.repoRoot,
						issueId,
						name,
						dataBase64,
					});

					if (isFail(result)) {
						return sendJson(res, 400, {
							isError: true,
							message: result.message,
						});
					}

					// The state, plus the new attachment, so the client can insert its reference.
					return sendJson(res, 200, {
						...(await getGuiState({repoRoot: project.repoRoot})),
						attachment: result.value,
					});
				});
			} catch (error) {
				return sendJson(res, 400, {
					isError: true,
					message:
						error instanceof Error ? error.message : 'Unable to add attachment',
				});
			}
		}

		if (
			req.method === 'DELETE' &&
			url.pathname.startsWith('/api/attachments/')
		) {
			const attachmentId = decodeURIComponent(
				url.pathname.replace('/api/attachments/', ''),
			);

			if (!attachmentId) {
				return sendJson(res, 400, {
					isError: true,
					message: 'Missing attachment id',
				});
			}

			return runMutation(res, async () => {
				const result = await deleteIssueAttachment({
					repoRoot: project.repoRoot,
					attachmentId,
				});

				if (isFail(result)) {
					return sendJson(res, 400, {
						isError: true,
						message: result.message,
					});
				}

				return sendJson(
					res,
					200,
					await getGuiState({repoRoot: project.repoRoot}),
				);
			});
		}

		if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
			const fileName = decodeURIComponent(url.pathname.replace('/media/', ''));

			const blobResult = await getAttachmentBlob({
				repoRoot: project.repoRoot,
				fileName,
			});

			if (isFail(blobResult)) {
				return sendJson(res, 404, {
					isError: true,
					message: blobResult.message,
				});
			}

			try {
				const file = await readFile(blobResult.value.filePath);

				res.writeHead(200, {
					'content-type':
						MEDIA_CONTENT_TYPES[blobResult.value.ext] ??
						'application/octet-stream',
					// content-addressed: the blob for a given name never changes
					'cache-control': 'public, max-age=31536000, immutable',
				});

				return res.end(file);
			} catch {
				return sendJson(res, 404, {
					isError: true,
					message: 'Attachment blob not found',
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

			return runMutation(res, async () => {
				const result = await deleteIssueComment({
					repoRoot: project.repoRoot,
					commentId,
				});

				if (isFail(result)) {
					return sendJson(res, 400, {
						isError: true,
						message: result.message,
					});
				}

				return sendJson(
					res,
					200,
					await getGuiState({repoRoot: project.repoRoot}),
				);
			});
		}

		// The client's own routes: a board, and the event log popped out of one.
		if (url.pathname.startsWith('/board/') || url.pathname === '/log') {
			return serveStatic('/', req, res);
		}

		return serveStatic(url.pathname, req, res);
	}

	try {
		boundPort = await listen(server);
	} catch (error) {
		return failed(
			error instanceof Error
				? `Unable to start GUI server: ${error.message}`
				: `Unable to start GUI server: ${String(error)}`,
		);
	}

	const publisher = createLogPublisher({project});
	const guiAutoSync = startGuiAutoSync({
		project,
		publisher,
		onReposFetch: minIntervalMs =>
			fetchReposAndBroadcast(project.repoRoot, minIntervalMs),
	});
	const stopLogWatch = startGuiLogWatch(publisher);

	setupWebsocket(server, project, {
		onStateChanged: () => guiAutoSync.queueSync(),
		onSyncSettingsChanged: () => guiAutoSync.reschedule(),
		getPort: () => boundPort,
	});

	server.on('close', () => {
		guiAutoSync.dispose();
		stopLogWatch();
	});

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
