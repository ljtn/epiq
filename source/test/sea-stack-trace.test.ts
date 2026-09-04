import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import {afterEach, describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const sourcePath = path.resolve(
	import.meta.dirname,
	'../scripts/sea-stack-trace.cjs',
);
const {prepareStackTrace, SEA_BUNDLE_NAME} = require(sourcePath) as {
	prepareStackTrace: NonNullable<typeof Error.prepareStackTrace>;
	SEA_BUNDLE_NAME: string;
};

// What the SEA bootstrap imports: the whole app, base64-encoded.
const bundleUrl = `data:application/javascript;base64,${Buffer.from(
	'x'.repeat(4096),
).toString('base64')}`;

const throwFromBundle = () =>
	vm.runInThisContext('(function boom() { throw new Error("nope"); })', {
		filename: bundleUrl,
	}) as () => never;

const previous = Error.prepareStackTrace;

afterEach(() => {
	Error.prepareStackTrace = previous;
});

describe('sea-stack-trace', () => {
	it('names the bundle instead of repeating its data: URL in every frame', () => {
		Error.prepareStackTrace = prepareStackTrace;

		let stack = '';
		try {
			throwFromBundle()();
		} catch (error) {
			stack = (error as Error).stack ?? '';
		}

		expect(stack.startsWith('Error: nope\n    at boom (')).toBe(true);
		expect(stack).toContain(`${SEA_BUNDLE_NAME}:1:`);
		expect(stack).not.toContain('base64');
		expect(stack.length).toBeLessThan(4096);
	});

	it('installs as the plain script the bootstrap inlines it as', () => {
		const source = fs.readFileSync(sourcePath, 'utf8');

		// Module scope, as in the CJS bootstrap: no `module`, no `require`.
		vm.runInThisContext(
			`(() => {\n${source}\nError.prepareStackTrace = prepareStackTrace;\n})()`,
			{filename: 'sea.cjs'},
		);

		expect(Error.prepareStackTrace).not.toBe(previous);
		expect(() => throwFromBundle()()).toThrow(
			expect.objectContaining({
				stack: expect.stringContaining(`${SEA_BUNDLE_NAME}:1:`),
			}),
		);
	});
});
