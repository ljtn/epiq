/**
 * Binding to loopback is not a security boundary in a browser. Any page the
 * user happens to have open can POST to `http://127.0.0.1:<port>`, and a
 * WebSocket handshake is exempt from the same-origin policy altogether — so
 * without this, a drive-by page could drive the whole board and `git push` the
 * damage.
 *
 * A browser always sends `Origin` on a WebSocket handshake and on any
 * state-changing method, so "present and not ours" is the whole attack. A
 * request with no `Origin` is not coming from a page and has nothing to spoof;
 * it is left alone so curl and the test harness keep working.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
	'127.0.0.1',
	'[::1]',
	'localhost',
	// What `startGuiServer` advertises.
	'epiq.localhost',
]);

export const isForeignOrigin = (
	origin: string | undefined,
	port: number,
): boolean => {
	if (!origin) return false;

	// A sandboxed iframe or a `file://` page. Opaque, so never ours.
	if (origin === 'null') return true;

	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return true;
	}

	if (url.protocol !== 'http:') return true;
	if (url.port !== String(port)) return true;

	return !LOOPBACK_HOSTS.has(url.hostname);
};

/**
 * Two independent gates, because either alone leaves a hole: `Origin` catches
 * a cross-origin request that carries one, and requiring JSON forces
 * everything else into a preflight this server never answers. Without the
 * second, a `text/plain` POST is a CORS *simple request* — no preflight, so
 * any page the user has open could write to the board.
 *
 * Returns the refusal to send, or null to let the request through.
 */
export const refuseCrossSiteRequest = (
	request: {
		method: string | undefined;
		origin: string | undefined;
		contentType: string | undefined;
	},
	port: number,
): {status: number; message: string} | null => {
	if (request.method === 'GET' || request.method === 'HEAD') return null;

	if (isForeignOrigin(request.origin, port)) {
		return {status: 403, message: 'Cross-origin request'};
	}

	if (
		request.method === 'POST' &&
		!(request.contentType ?? '').toLowerCase().startsWith('application/json')
	) {
		return {status: 415, message: 'Expected content-type: application/json'};
	}

	return null;
};
