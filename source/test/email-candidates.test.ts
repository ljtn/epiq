import {describe, expect, it, vi, beforeEach} from 'vitest';
import {EmailLink, emailLinkKey} from '../lib/model/email-link.js';
import {
	findEmailCandidates,
	offerableCandidates,
} from '../lib/repository/email-candidates.js';
import {execGitAllowFail} from '../git/git-utils.js';

vi.mock('../git/git-utils.js', () => ({execGitAllowFail: vi.fn()}));

const FIELD = '\u001f';

const history = (rows: [string, string][]) =>
	vi.mocked(execGitAllowFail).mockResolvedValue({
		stdout: rows.map(([name, email]) => `${name}${FIELD}${email}`).join('\n'),
		stderr: '',
		exitCode: 0,
	} as never);

const linked = (...links: EmailLink[]): Record<string, EmailLink> =>
	Object.fromEntries(
		links.map(link => [emailLinkKey(link.email, link.contributor), link]),
	);

const scan = (names: (string | null)[], links = {}) =>
	findEmailCandidates({repoRoot: '/repo', names, links});

describe('findEmailCandidates', () => {
	beforeEach(() => vi.mocked(execGitAllowFail).mockReset());

	it('counts commits per address and remembers the names on them', async () => {
		history([
			['Jonatan Lampa', 'jola@example.com'],
			['Jonatan Lampa', 'jola@example.com'],
			['Sam Rivers', 'sam@example.com'],
		]);

		const found = await scan(['jola']);

		expect(found).toHaveLength(2);
		expect(found[0]).toMatchObject({
			email: 'jola@example.com',
			commits: 2,
			names: ['Jonatan Lampa'],
			looksLikeYours: true,
		});
	});

	// A short board handle beside a full git name is the ordinary setup, so an
	// equality rule would offer nothing to the people this exists for.
	it('matches a name token rather than the whole name', async () => {
		history([['Jonatan Lampa', 'whatever@example.com']]);

		expect((await scan(['jo']))[0]?.looksLikeYours).toBe(false);
		expect((await scan(['lampa']))[0]?.looksLikeYours).toBe(true);
	});

	it('matches on the local part, which no commit name carries', async () => {
		history([['Some Machine', 'jola@ci.example.com']]);

		expect((await scan(['jola']))[0]?.looksLikeYours).toBe(true);
	});

	it('normalizes, so one address is one candidate', async () => {
		history([
			['Jola', 'JOLA@Example.com'],
			['jola', 'jola@example.com '],
		]);

		const found = await scan(['jola']);

		expect(found).toHaveLength(1);
		expect(found[0]?.commits).toBe(2);
	});

	it('reports who already claims an address', async () => {
		history([['Jola', 'jola@example.com']]);

		const [found] = await scan(
			['jola'],
			linked({
				email: 'jola@example.com',
				contributor: 'alice',
				authorId: 'alice',
			}),
		);

		expect(found?.claimedBy).toEqual(['alice']);
	});

	it('survives a repository git cannot read', async () => {
		vi.mocked(execGitAllowFail).mockResolvedValue({
			stdout: '',
			stderr: 'not a repository',
			exitCode: 128,
		} as never);

		expect(await scan(['jola'])).toEqual([]);
	});

	it('puts likely addresses first, then the busiest', async () => {
		history([
			['Stranger', 'stranger@example.com'],
			['Stranger', 'stranger@example.com'],
			['Stranger', 'stranger@example.com'],
			['jola', 'jola@example.com'],
		]);

		expect((await scan(['jola'])).map(c => c.email)).toEqual([
			'jola@example.com',
			'stranger@example.com',
		]);
	});
});

describe('offerableCandidates', () => {
	// Offering a claimed address would be offering to make it contested, which is
	// the state this whole feature exists to avoid walking into by accident.
	it('drops anything somebody already claims', () => {
		const offered = offerableCandidates([
			{
				email: 'free@example.com',
				names: [],
				commits: 1,
				looksLikeYours: true,
				claimedBy: [],
			},
			{
				email: 'taken@example.com',
				names: [],
				commits: 9,
				looksLikeYours: true,
				claimedBy: ['alice'],
			},
		]);

		expect(offered.map(c => c.email)).toEqual(['free@example.com']);
	});
});
