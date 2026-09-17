import {describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {bootStateFromEventLog} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	canRemoveEmailLink,
	claimantsOf,
	emailLinkKey,
	emailOwnerIndex,
	emailsOf,
	isValidEmail,
	normalizeEmail,
	resolveEmailOwner,
} from '../lib/model/email-link.js';
import {isFail} from '../lib/model/result-types.js';
import {getState} from '../lib/state/state.js';

const WORKSPACE = '01J000000000000000000WSPC';
const ALICE = '01J00000000000000000ALICE';
const BOB = '01J0000000000000000000BOB';
const CAROL = '01J00000000000000000CAROL';

let seq = 0;
const by = <A extends AppEvent['action']>(
	userId: string,
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): AppEvent =>
	({
		id: ulid(1_700_000_000_000 + seq++),
		action,
		payload,
		userId,
	} as AppEvent);

const base = (): AppEvent[] => [
	by(ALICE, 'init.workspace', {id: WORKSPACE, name: 'Workspace', rank: 'a0'}),
	by(ALICE, 'create.contributor', {id: ALICE, name: 'alice'}),
	by(ALICE, 'create.contributor', {id: BOB, name: 'bob'}),
	by(ALICE, 'create.contributor', {id: CAROL, name: 'carol'}),
];

const boot = (events: AppEvent[]) => {
	const result = bootStateFromEventLog(events);
	if (isFail(result)) throw new Error(result.message);
	return getState().emailLinks;
};

describe('normalizeEmail', () => {
	// The stored form is a contract: every link ever written is matched through
	// this, so a change to it silently stops them all matching.
	it('trims and lowercases, so one address has one stored form', () => {
		expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
	});

	it('keeps obvious rubbish out without pretending to validate RFC 5321', () => {
		expect(isValidEmail('alice@example.com')).toBe(true);
		expect(isValidEmail('12345+handle@users.noreply.github.com')).toBe(true);
		expect(isValidEmail('not an address')).toBe(false);
		expect(isValidEmail('')).toBe(false);
		expect(isValidEmail(`${'a'.repeat(250)}@b.com`)).toBe(false);
	});
});

describe('linking', () => {
	it('binds an address to a contributor', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
		]);

		expect(resolveEmailOwner(links, 'alice@example.com')).toBe(ALICE);
		expect(emailsOf(links, ALICE)).toEqual(['alice@example.com']);
	});

	it('stores the normalized form, whatever the writer sent', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: '  Alice@Example.COM  ',
			}),
		]);

		// Matched by the normalized address, and by the raw one, which normalizes
		// to the same thing on the way in.
		expect(resolveEmailOwner(links, 'alice@example.com')).toBe(ALICE);
		expect(resolveEmailOwner(links, 'ALICE@EXAMPLE.com')).toBe(ALICE);
	});

	it('holds several addresses for one contributor, so a change of address needs no migration', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'old@job.com',
			}),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: '1+alice@users.noreply.github.com',
			}),
		]);

		expect(emailsOf(links, ALICE).sort()).toEqual([
			'1+alice@users.noreply.github.com',
			'old@job.com',
		]);
		expect(resolveEmailOwner(links, 'old@job.com')).toBe(ALICE);
	});

	it('lets one person link another, so a teammate who never opens epiq still resolves', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: BOB,
				email: 'bob@example.com',
			}),
		]);

		expect(resolveEmailOwner(links, 'bob@example.com')).toBe(BOB);
	});

	it('is idempotent, so a replay that sees one event twice lands in the same place', () => {
		const link = by(ALICE, 'link.contributor.email', {
			contributor: ALICE,
			email: 'alice@example.com',
		});

		const links = boot([
			...base(),
			link,
			{...link, id: ulid(1_700_000_099_999)},
		]);

		expect(Object.keys(links)).toHaveLength(1);
		expect(resolveEmailOwner(links, 'alice@example.com')).toBe(ALICE);
	});

	it('skips a link naming a contributor the board has never heard of', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: '01J000000000000000STRANGE',
				email: 'stranger@example.com',
			}),
		]);

		expect(links).toEqual({});
	});
});

describe('a contested address', () => {
	// Reachable with no attacker at all: two people sharing one git user.email.
	it('resolves to nobody once two contributors claim it', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'team@example.com',
			}),
			by(BOB, 'link.contributor.email', {
				contributor: BOB,
				email: 'team@example.com',
			}),
		]);

		expect(resolveEmailOwner(links, 'team@example.com')).toBeUndefined();
		expect(claimantsOf(links, 'team@example.com').sort()).toEqual(
			[ALICE, BOB].sort(),
		);
	});

	it('resolves again once one claim is retracted', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'team@example.com',
			}),
			by(BOB, 'link.contributor.email', {
				contributor: BOB,
				email: 'team@example.com',
			}),
			by(BOB, 'unlink.contributor.email', {
				contributor: BOB,
				email: 'team@example.com',
			}),
		]);

		expect(resolveEmailOwner(links, 'team@example.com')).toBe(ALICE);
	});

	it('is absent from the owner index rather than present and empty', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'team@example.com',
			}),
			by(BOB, 'link.contributor.email', {
				contributor: BOB,
				email: 'team@example.com',
			}),
			by(CAROL, 'link.contributor.email', {
				contributor: CAROL,
				email: 'carol@example.com',
			}),
		]);

		const index = emailOwnerIndex(links);

		expect(index.has('team@example.com')).toBe(false);
		expect(index.get('carol@example.com')).toBe(CAROL);
	});
});

describe('unlinking', () => {
	it('lets the author of a link retract it', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: BOB,
				email: 'bob@example.com',
			}),
			by(ALICE, 'unlink.contributor.email', {
				contributor: BOB,
				email: 'bob@example.com',
			}),
		]);

		expect(resolveEmailOwner(links, 'bob@example.com')).toBeUndefined();
	});

	it('lets the contributor a link names disown it, though somebody else wrote it', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: BOB,
				email: 'bob@example.com',
			}),
			by(BOB, 'unlink.contributor.email', {
				contributor: BOB,
				email: 'bob@example.com',
			}),
		]);

		expect(resolveEmailOwner(links, 'bob@example.com')).toBeUndefined();
	});

	// The whole point of not mirroring the payload: open removal would let one
	// writer strip every link on the board, repeatedly and forever.
	it('refuses a stranger, so nobody can strip links they neither wrote nor own', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
			by(CAROL, 'unlink.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
		]);

		expect(resolveEmailOwner(links, 'alice@example.com')).toBe(ALICE);
	});

	it('keeps the record, so a retraction is forward-only', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
			by(ALICE, 'unlink.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
		]);

		const key = emailLinkKey('alice@example.com', ALICE);

		expect(links[key]).toMatchObject({tombstoned: true, authorId: ALICE});
	});

	it('can be re-linked afterwards', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
			by(ALICE, 'unlink.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
		]);

		expect(resolveEmailOwner(links, 'alice@example.com')).toBe(ALICE);
	});

	it('skips an unlink for a link that was never written', () => {
		const links = boot([
			...base(),
			by(ALICE, 'unlink.contributor.email', {
				contributor: ALICE,
				email: 'never@example.com',
			}),
		]);

		expect(links).toEqual({});
	});
});

describe('canRemoveEmailLink', () => {
	const link = {
		email: 'alice@example.com',
		contributor: ALICE,
		authorId: BOB,
	};

	it('admits the author and the target, and nobody else', () => {
		expect(canRemoveEmailLink(BOB, link)).toBe(true);
		expect(canRemoveEmailLink(ALICE, link)).toBe(true);
		expect(canRemoveEmailLink(CAROL, link)).toBe(false);
	});

	// A squatted address can be co-claimed to make it contested, which stops it
	// resolving to the squatter, but never reclaimed. Reclaiming and stripping
	// are the same capability; separating them needs signed commits.
	it('does not let the owner of an address remove somebody else claim on it', () => {
		const squat = {
			email: 'alice@example.com',
			contributor: CAROL,
			authorId: CAROL,
		};

		expect(canRemoveEmailLink(ALICE, squat)).toBe(false);
	});
});

describe('the stored key', () => {
	// A control character would be the natural separator and is not worth it: one
	// in a source file makes the file binary to git, so diff, blame and grep all
	// quietly stop working on it. A space is safe only because a stored address
	// has no whitespace, which the handler enforces.
	it('is plain text, so nothing downstream has to cope with a control character', () => {
		expect(emailLinkKey('alice@example.com', ALICE)).not.toMatch(
			/[\u0000-\u001f]/,
		);
	});

	it('skips a link whose address could split the key', () => {
		const links = boot([
			...base(),
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com x',
			}),
		]);

		expect(links).toEqual({});
	});

	it('keeps two contributors on one address apart', () => {
		expect(emailLinkKey('a@b.com', ALICE)).not.toBe(
			emailLinkKey('a@b.com', BOB),
		);
	});
});
