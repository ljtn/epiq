import {describe, expect, it} from 'vitest';
import {decodePath} from '../gui/api/api-server.js';

// A path that won't decode, like `GET /%`, is a 404 rather than a thrown
// URIError that would end the server.

describe('decodePath', () => {
	it('decodes an ordinary path', () => {
		expect(decodePath('/main.js')).toBe('/main.js');
	});

	it('decodes an escaped one', () => {
		expect(decodePath('/a%20file.js')).toBe('/a file.js');
	});

	// The reported crash, and its neighbours.
	it('refuses a stray percent rather than throwing', () => {
		expect(decodePath('/%')).toBeNull();
		expect(decodePath('/%zz')).toBeNull();
		expect(decodePath('/%e0%a4%a')).toBeNull();
		expect(decodePath('/main.js%')).toBeNull();
	});

	// A lone surrogate is well-formed percent-encoding and decodes; it is the
	// path resolution below, not this, that decides it names nothing.
	it('decodes what is decodable, and leaves the rest to the path check', () => {
		expect(decodePath('/%2e%2e%2f%2e%2e%2fetc/passwd')).toBe(
			'/../../etc/passwd',
		);
	});
});
