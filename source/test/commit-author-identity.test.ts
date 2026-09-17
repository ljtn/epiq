import {describe, expect, it} from 'vitest';
import {commitAuthorIdentity} from '../lib/repository/contributor-directory.js';
import {EmailLink, emailLinkKey} from '../lib/model/email-link.js';
import {Contributor} from '../lib/model/app-state.model.js';

const ALICE = '01J00000000000000000ALICE';
const BOB = '01J0000000000000000000BOB';

const registry: Record<string, Contributor> = {
	[ALICE]: {id: ALICE, name: 'alice'},
	[BOB]: {id: BOB, name: 'bob'},
};

const linked = (...links: EmailLink[]): Record<string, EmailLink> =>
	Object.fromEntries(
		links.map(link => [emailLinkKey(link.email, link.contributor), link]),
	);

const resolve = (
	authorName: string,
	authorEmail: string,
	links: Record<string, EmailLink> = {},
) => commitAuthorIdentity({authorName, authorEmail, links, registry});

describe('commitAuthorIdentity', () => {
	it('names the contributor whose address it is', () => {
		const identity = resolve(
			'Jonatan Lampa',
			'jola@example.com',
			linked({email: 'jola@example.com', contributor: ALICE, authorId: ALICE}),
		);

		expect(identity.id).toBe(ALICE);
		expect(identity.name).toBe('alice');
	});

	it('matches whatever case the commit carries', () => {
		const identity = resolve(
			'Jonatan Lampa',
			'JoLa@Example.COM',
			linked({email: 'jola@example.com', contributor: ALICE, authorId: ALICE}),
		);

		expect(identity.id).toBe(ALICE);
	});

	it('keeps the raw git name when nobody has claimed the address', () => {
		const identity = resolve('Jonatan Lampa', 'jola@example.com');

		expect(identity.name).toBe('Jonatan Lampa');
		expect(identity.id).toBe('jola@example.com');
	});

	// The reason unmatched authors are keyed by address: two different people
	// called "dev" must not merge into one face on a chart.
	it('keeps two unmatched committers sharing a name apart', () => {
		const one = resolve('dev', 'one@example.com');
		const two = resolve('dev', 'two@example.com');

		expect(one.id).not.toBe(two.id);
	});

	it('keeps the raw name when two contributors claim the address', () => {
		const identity = resolve(
			'Shared Box',
			'team@example.com',
			linked(
				{email: 'team@example.com', contributor: ALICE, authorId: ALICE},
				{email: 'team@example.com', contributor: BOB, authorId: BOB},
			),
		);

		expect(identity.name).toBe('Shared Box');
	});

	it('ignores a retracted claim', () => {
		const identity = resolve(
			'Jonatan Lampa',
			'jola@example.com',
			linked({
				email: 'jola@example.com',
				contributor: ALICE,
				authorId: ALICE,
				tombstoned: true,
			}),
		);

		expect(identity.name).toBe('Jonatan Lampa');
	});

	it('survives a commit with no address at all', () => {
		const identity = resolve('Ancient Import', '');

		expect(identity.name).toBe('Ancient Import');
	});

	it('gives a matched author the colour their board identity has', () => {
		const identity = resolve(
			'Jonatan Lampa',
			'jola@example.com',
			linked({email: 'jola@example.com', contributor: ALICE, authorId: ALICE}),
		);

		expect(identity.color).toBe(resolveColourOf('alice'));
	});
});

// The colour follows from the name, so this is the same call identityOf makes.
const resolveColourOf = (name: string) =>
	commitAuthorIdentity({
		authorName: name,
		authorEmail: '',
		links: {},
		registry: {},
	}).color;
