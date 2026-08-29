import {describe, expect, it} from 'vitest';
import {
	isForeignOrigin,
	refuseCrossSiteRequest,
} from '../gui/api/lib/origin-guard.js';

describe('isForeignOrigin', () => {
	const PORT = 3710;

	// Not a browser, so there is no page to be tricked and nothing to spoof.
	it('lets a request with no Origin through', () => {
		expect(isForeignOrigin(undefined, PORT)).toBe(false);
	});

	it.each([
		'http://127.0.0.1:3710',
		'http://localhost:3710',
		'http://epiq.localhost:3710',
		'http://[::1]:3710',
	])('accepts our own origin %s', origin => {
		expect(isForeignOrigin(origin, PORT)).toBe(false);
	});

	it.each([
		// The whole point: any page the user happens to have open.
		'https://evil.example',
		'http://evil.example',
		// Right host, wrong server — another local app on another port.
		'http://127.0.0.1:8080',
		// A hostname that merely ends in one of ours.
		'http://notlocalhost:3710',
		'http://evil.epiq.localhost:3710',
		// https on our port is still not a page this server served.
		'https://127.0.0.1:3710',
		// A sandboxed iframe or a file:// page.
		'null',
		'not a url',
	])('rejects %s', origin => {
		expect(isForeignOrigin(origin, PORT)).toBe(true);
	});
});

describe('refuseCrossSiteRequest', () => {
	const PORT = 3710;

	const refuse = (
		method: string,
		origin?: string,
		contentType?: string,
	): ReturnType<typeof refuseCrossSiteRequest> =>
		refuseCrossSiteRequest({method, origin, contentType}, PORT);

	it('never refuses a read', () => {
		expect(refuse('GET', 'https://evil.example')).toBeNull();
		expect(refuse('HEAD', 'https://evil.example')).toBeNull();
	});

	it('refuses a write carrying a foreign Origin', () => {
		expect(refuse('POST', 'https://evil.example', 'application/json')).toEqual({
			status: 403,
			message: 'Cross-origin request',
		});
		expect(refuse('DELETE', 'https://evil.example')).toEqual({
			status: 403,
			message: 'Cross-origin request',
		});
	});

	// The CSRF that needs no Origin to be wrong: `text/plain` is a CORS simple
	// request, so the browser sends it with no preflight at all.
	it('refuses a POST that is not JSON', () => {
		expect(refuse('POST', undefined, 'text/plain;charset=UTF-8')).toEqual({
			status: 415,
			message: 'Expected content-type: application/json',
		});
		expect(refuse('POST', undefined, undefined)?.status).toBe(415);
	});

	it('allows the GUI page’s own writes', () => {
		expect(
			refuse('POST', 'http://epiq.localhost:3710', 'application/json'),
		).toBeNull();
		expect(refuse('DELETE', 'http://127.0.0.1:3710')).toBeNull();
	});
});
