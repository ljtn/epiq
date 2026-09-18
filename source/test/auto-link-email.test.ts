import {beforeEach, describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {ensureEmailLinked} from '../lib/board/board-contributor.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {bootStateFromEventLog} from '../lib/board/board-boot.js';
import {materializeAll} from '../lib/board/board-log.js';
import {claimantsOf, emailsOf} from '../lib/model/email-link.js';
import {failed, isFail, succeeded} from '../lib/model/result-types.js';
import {patchSettingsState} from '../lib/state/settings.state.js';
import {getState} from '../lib/state/state.js';

const WORKSPACE = '01J000000000000000000WSPC';
const ALICE = '01J00000000000000000ALICE';
const BOB = '01J0000000000000000000BOB';

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

const board = (extra: AppEvent[] = []) => {
	const result = bootStateFromEventLog([
		by(ALICE, 'init.workspace', {id: WORKSPACE, name: 'Workspace', rank: 'a0'}),
		by(ALICE, 'create.contributor', {id: ALICE, name: 'alice'}),
		by(ALICE, 'create.contributor', {id: BOB, name: 'bob'}),
		...extra,
	]);
	if (isFail(result)) throw new Error(result.message);
};

// A stand-in for the log's own writer. It runs the real materializer, so an
// event the board would refuse is refused here too — a double that accepted
// everything hid a bug that made every write fail, because the hook's own
// output was never put through the rules it has to satisfy.
const writer = () => {
	const written: AppEvent[] = [];
	return {
		written,
		writeOne: (event: AppEvent) => {
			written.push(event);
			const [result] = materializeAll([event]);
			return result ?? succeeded('Wrote', null);
		},
	};
};

const anyWrite = (userId: string) =>
	by(userId, 'edit.title', {id: WORKSPACE, name: 'Renamed'});

describe('the git address links itself', () => {
	beforeEach(() => {
		patchSettingsState({userId: ALICE, userName: 'alice', gitEmail: null});
	});

	it('on the first write, for the configured user', () => {
		board();
		patchSettingsState({gitEmail: 'alice@example.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite(ALICE), writeOne);

		expect(written).toHaveLength(1);
		expect(written[0]).toMatchObject({
			action: 'link.contributor.email',
			payload: {contributor: ALICE, email: 'alice@example.com'},
			userId: ALICE,
		});
	});

	it('not twice, once the address is already ours', () => {
		board([
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
		]);
		patchSettingsState({gitEmail: 'alice@example.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite(ALICE), writeOne);

		expect(written).toEqual([]);
	});

	// Two colleagues on one git user.email. Without this check they would each
	// link it unprompted and neither would resolve afterwards, having done
	// nothing wrong.
	it('never over an address another contributor already claims', () => {
		board([
			by(BOB, 'link.contributor.email', {
				contributor: BOB,
				email: 'team@example.com',
			}),
		]);
		patchSettingsState({gitEmail: 'team@example.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite(ALICE), writeOne);

		expect(written).toEqual([]);
		expect(claimantsOf(getState().emailLinks, 'team@example.com')).toEqual([
			BOB,
		]);
	});

	it('not on somebody else write', () => {
		board();
		patchSettingsState({gitEmail: 'alice@example.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite(BOB), writeOne);

		expect(written).toEqual([]);
	});

	// An agent commits as the repository's git user, not as itself, so its board
	// identity has no address of its own to claim. It writes under an assumed id,
	// which is not the configured one, so it fails the same test as above.
	it('not for an agent writing under an assumed identity', () => {
		board();
		patchSettingsState({gitEmail: 'alice@example.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite('01J0000000000000000AGENT'), writeOne);

		expect(written).toEqual([]);
	});

	// Git takes any string here, and people put one in: a pasted whole ident, a
	// bare username, a typo. Before this guard the hook wrote an event the
	// materializer refused, `beforeWrite` turned that into a failure, and the
	// user's own write was aborted — on every write, permanently, on all three
	// surfaces.
	it.each([
		'Jonatan Lampa <jola@x.com>',
		'root',
		'a@b@c',
		'no spaces @ allowed.com',
	])('is skipped when git user.email is not an address: %s', bad => {
		board();
		patchSettingsState({gitEmail: bad});

		const {written, writeOne} = writer();
		const result = ensureEmailLinked(anyWrite(ALICE), writeOne);

		expect(written).toEqual([]);
		// Succeeded, not failed: a failure here aborts the write the user asked
		// for, which is not this hook's to refuse.
		expect(isFail(result)).toBe(false);
	});

	// Belt and braces for the same rule: whatever goes wrong downstream, the
	// caller's write still goes through.
	it('never fails the caller write, even when the link cannot be written', () => {
		board();
		patchSettingsState({gitEmail: 'alice@example.com'});

		const result = ensureEmailLinked(anyWrite(ALICE), () =>
			failed('disk is on fire'),
		);

		expect(isFail(result)).toBe(false);
	});

	it('not when the repository has no configured address', () => {
		board();
		patchSettingsState({gitEmail: null});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite(ALICE), writeOne);

		expect(written).toEqual([]);
	});

	it('not before the contributor exists, so the link cannot outrun its subject', () => {
		const result = bootStateFromEventLog([
			by(ALICE, 'init.workspace', {
				id: WORKSPACE,
				name: 'Workspace',
				rank: 'a0',
			}),
		]);
		if (isFail(result)) throw new Error(result.message);
		patchSettingsState({gitEmail: 'alice@example.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite(ALICE), writeOne);

		expect(written).toEqual([]);
	});

	it('does not recurse on its own write', () => {
		board();
		patchSettingsState({gitEmail: 'alice@example.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
			writeOne,
		);

		expect(written).toEqual([]);
	});

	// The Unlink button in the panel is about the configured address more often
	// than not, and this hook runs on every write afterwards.
	it('never puts back the configured address after it is unlinked on purpose', () => {
		board([
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
			by(ALICE, 'unlink.contributor.email', {
				contributor: ALICE,
				email: 'alice@example.com',
			}),
		]);
		patchSettingsState({gitEmail: 'alice@example.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite(ALICE), writeOne);
		ensureEmailLinked(anyWrite(ALICE), writeOne);

		expect(written).toEqual([]);
	});

	it('links the new address when git changes, and leaves the old one linked', () => {
		board([
			by(ALICE, 'link.contributor.email', {
				contributor: ALICE,
				email: 'old@job.com',
			}),
		]);
		patchSettingsState({gitEmail: 'new@job.com'});

		const {written, writeOne} = writer();
		ensureEmailLinked(anyWrite(ALICE), writeOne);

		expect(written[0]).toMatchObject({
			payload: {contributor: ALICE, email: 'new@job.com'},
		});
		// Both, because links are additive: a change of address needs no
		// migration and commits under the old one keep resolving.
		expect(emailsOf(getState().emailLinks, ALICE).sort()).toEqual([
			'new@job.com',
			'old@job.com',
		]);
	});
});
