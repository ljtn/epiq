import {ulid} from 'ulid';
import {claimantsOf, normalizeEmail} from '../model/email-link.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getSettingsState} from '../state/settings.state.js';
import {AppEvent} from './board-events.model.js';

// Where a rename reaches the board. Nothing on disk carries a display name —
// not the log's file name, not the event — so the registry only learns one
// from an event, and every write passes through here first.
export const ensureContributorCurrent = (
	event: AppEvent,
	writeOne: (event: AppEvent) => Result<unknown>,
): Result<void> => {
	if (
		event.action === 'create.contributor' ||
		event.action === 'rename.contributor'
	) {
		return succeeded('Contributor write already in flight', undefined);
	}

	// Our own name and nobody else's. An event carries no name, so the only one
	// this process can vouch for is the identity it is configured with —
	// attaching that to somebody else's event would rename them.
	//
	// The settings store, which every surface fills at boot — the TUI and GUI
	// on start-up, the MCP in `boot()`. Reading config here instead would drag
	// the whole config module graph into every caller of this file.
	//
	// Read raw rather than through `resolveActorId`, whose extra validation is
	// about whether the config is well formed. The question here is only
	// whether this write is our own: an id that does not match is somebody
	// else's event, and attaching our name to it would rename them.
	const {userId: configuredId, userName} = getSettingsState();
	if (!userName || configuredId !== event.userId) {
		return succeeded('Not this actor own write', undefined);
	}

	const contributor = nodeRepo.getContributor(event.userId);

	const actorEvent: AppEvent<'create.contributor' | 'rename.contributor'> = {
		id: ulid(),
		action: contributor ? 'rename.contributor' : 'create.contributor',
		payload: {
			id: event.userId,
			name: userName,
		},
		userId: event.userId,
	};

	// A tombstoned name was cleared on purpose, so renaming would put it back.
	// `restore.contributor` is the way back.
	if (
		contributor &&
		(contributor.tombstoned || contributor.name === userName)
	) {
		return succeeded('Contributor name is current', undefined);
	}

	const result = writeOne(actorEvent);

	if (isFail(result)) {
		return failed(result.message);
	}

	return succeeded('Contributor name recorded', undefined);
};

/**
 * Links this repository's git address to whoever is writing, once, so that a
 * person's commits and their board events read as one person without anybody
 * being asked.
 *
 * The one step in this feature with no human behind it, which is why it checks
 * before writing. A claimed address resolves to nobody rather than to one of
 * its claimants, so two colleagues sharing a git `user.email` would each link
 * it unprompted and break each other's attribution, having done nothing wrong.
 * Leaving the first claim alone keeps one of them working instead of neither.
 *
 * Best effort by nature: two machines can link the same address concurrently
 * without seeing each other, and both land. `WABMTYY` names that state in the
 * UI, which is the backstop rather than an extra.
 */
export const ensureEmailLinked = (
	event: AppEvent,
	writeOne: (event: AppEvent) => Result<unknown>,
): Result<void> => {
	if (
		event.action === 'link.contributor.email' ||
		event.action === 'unlink.contributor.email'
	) {
		return succeeded('Link write already in flight', undefined);
	}

	const {userId: configuredId, gitEmail} = getSettingsState();

	// Our own write and nobody else's, the same test the rename above makes.
	// `getSettingsState` holds the configured user, so an agent writing under an
	// assumed identity fails this and is skipped — which is what should happen:
	// an agent commits as the repository's git user, not as itself, so its board
	// identity has no git address to claim.
	if (!gitEmail || !configuredId || configuredId !== event.userId) {
		return succeeded('Not this actor own write', undefined);
	}

	// Only a contributor the board knows, so the link cannot land before the
	// `create.contributor` that `ensureContributorCurrent` writes.
	if (!nodeRepo.getContributor(configuredId)) {
		return succeeded('Contributor not registered yet', undefined);
	}

	const email = normalizeEmail(gitEmail);
	const claimants = claimantsOf(nodeRepo.getEmailLinks(), email);

	// Already ours, or somebody else's. Re-linking our own is a no-op the
	// materializer would absorb anyway; taking a second claim on somebody else's
	// is the case worth refusing.
	if (claimants.length > 0) {
		return succeeded(
			claimants.includes(configuredId)
				? 'Email already linked'
				: 'Email is claimed by another contributor',
			undefined,
		);
	}

	const result = writeOne({
		id: ulid(),
		action: 'link.contributor.email',
		payload: {contributor: configuredId, email},
		userId: configuredId,
	} satisfies AppEvent<'link.contributor.email'>);

	if (isFail(result)) return failed(result.message);

	return succeeded('Git address linked', undefined);
};
