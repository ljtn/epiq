import {beforeEach, describe, expect, it, vi} from 'vitest';

/**
 * `boot()` runs on every MCP call and every socket message, above the fast path
 * that exists to avoid redundant work. A read here that is not cached is a git
 * subprocess per request, which no test notices and every user pays for. The
 * address read was cached for exactly that reason and the name read, added
 * later, was not.
 */
vi.mock('../git/git-utils.js', () => ({execGitAllowFail: vi.fn()}));

const {execGitAllowFail} = await import('../git/git-utils.js');
const {
	readGitEmail,
	readGitIdentity,
	readGitName,
	resetGitIdentityCacheForTests,
} = await import('../lib/config/git-identity.js');

const config = (stdout: string, exitCode = 0) =>
	vi.mocked(execGitAllowFail).mockResolvedValue({
		stdout,
		stderr: '',
		exitCode,
	} as never);

const BOTH = 'user.name Jonatan Lampa\nuser.email Jola@Example.com';

beforeEach(() => {
	vi.clearAllMocks();
	resetGitIdentityCacheForTests();
	config(BOTH);
});

describe('reading the git identity', () => {
	it('gives both halves, the address normalized', async () => {
		expect(await readGitIdentity('/repo')).toEqual({
			name: 'Jonatan Lampa',
			email: 'jola@example.com',
		});
	});

	it('asks git once for the pair, not once each', async () => {
		await readGitEmail('/repo');
		await readGitName('/repo');
		await readGitIdentity('/repo');

		expect(execGitAllowFail).toHaveBeenCalledTimes(1);
	});

	it('asks again for another repository', async () => {
		await readGitIdentity('/repo');
		await readGitIdentity('/other');

		expect(execGitAllowFail).toHaveBeenCalledTimes(2);
	});

	it('is nothing at all when git has neither', async () => {
		config('', 1);

		expect(await readGitIdentity('/repo')).toEqual({name: null, email: null});
	});

	it('is half an answer when git has one of them', async () => {
		config('user.email jola@example.com');

		expect(await readGitIdentity('/repo')).toEqual({
			name: null,
			email: 'jola@example.com',
		});
	});
});

describe('a configured value is whatever the file says', () => {
	// A name is one line of anything, and every caller treats it as a string to
	// show or to tokenize. What must not happen is a name being read as a key,
	// or a value with spaces losing its tail.
	it('keeps a name that contains spaces', async () => {
		config('user.name  Jonatan  van der Lampa ');

		expect((await readGitIdentity('/repo')).name).toBe(
			'Jonatan  van der Lampa',
		);
	});

	it('does not let a name that looks like a key become one', async () => {
		config('user.name user.email evil@attacker.com');

		expect(await readGitIdentity('/repo')).toEqual({
			name: 'user.email evil@attacker.com',
			email: null,
		});
	});

	it('ignores any other setting that came back', async () => {
		config('user.signingkey ABC\nuser.name Jonatan Lampa');

		expect((await readGitIdentity('/repo')).name).toBe('Jonatan Lampa');
	});

	it('is null rather than empty for a setting with no value', async () => {
		config('user.name \nuser.email  ');

		expect(await readGitIdentity('/repo')).toEqual({name: null, email: null});
	});
});
