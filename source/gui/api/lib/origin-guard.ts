/**
 * Loopback is no boundary in a browser: any open page can POST here or open a
 * WebSocket. A request with no `Origin` is not from a page and is let through.
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
 * Refuses a foreign `Origin`, and anything not JSON: a `text/plain` POST skips
 * the CORS preflight. Returns the refusal, or null.
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
