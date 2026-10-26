import crypto from 'node:crypto';
import {failed, Result, succeeded} from '../model/result-types.js';
import {User} from '../state/settings.state.js';

export const ACTOR_NAME_ENV = 'EPIQ_USER_NAME';
export const ACTOR_ID_ENV = 'EPIQ_USER_ID';

// Crockford base32 — ULID's alphabet, without I, L, O and U.
const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 26;
const MAX_NAME_LENGTH = 80;

export const isValidUserId = (value: string): boolean =>
	/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);

export const isValidUserName = (value: string): boolean =>
	value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * One name is one id on every machine: a digest, since a fresh `ulid()` per
 * process would register a new contributor and log file on every run.
 */
export const deriveActorId = (name: string): string => {
	const digest = crypto
		.createHash('sha256')
		.update(`epiq:actor:${normalize(name)}`)
		.digest();

	let id = '';

	for (let index = 0; index < ID_LENGTH; index++) {
		id += ID_ALPHABET[(digest[index] ?? 0) % ID_ALPHABET.length];
	}

	return id;
};

/**
 * Lets a process act as someone other than the configured user, so agents
 * sharing a machine write as themselves. Null when the environment asks for nothing.
 */
export const resolveEnvActor = (
	configured: Partial<User>,
	env: NodeJS.ProcessEnv = process.env,
): Result<User | null> => {
	const name = (env[ACTOR_NAME_ENV] ?? '').trim();
	const pinnedId = (env[ACTOR_ID_ENV] ?? '').trim();

	if (!name) {
		if (!pinnedId) return succeeded('No actor override', null);

		return failed(`${ACTOR_ID_ENV} is set without ${ACTOR_NAME_ENV}`);
	}

	if (!isValidUserName(name)) {
		return failed(
			`${ACTOR_NAME_ENV} must be 1-${MAX_NAME_LENGTH} characters of text`,
		);
	}

	// Naming the configured user is not a second identity. Deriving one here
	// would fork them into a second contributor holding the same name.
	if (
		!pinnedId &&
		configured.userId &&
		configured.userName &&
		normalize(configured.userName) === normalize(name)
	) {
		return succeeded('Actor override names the configured user', {
			userId: configured.userId,
			userName: configured.userName,
		});
	}

	// Loud, because the quiet alternative is falling back to the configured
	// user: the agent would write as the person it is meant to be told from.
	if (pinnedId && !isValidUserId(pinnedId)) {
		return failed(`${ACTOR_ID_ENV} must be 26 characters of Crockford base32`);
	}

	// Writing under someone else's id renames them: the first write emits a
	// `rename.contributor`, and the board carries this name for them from then on.
	if (pinnedId && configured.userId && pinnedId === configured.userId) {
		return failed(
			`${ACTOR_ID_ENV} is the configured user's own id; using it under a different name would rename them on the board`,
		);
	}

	// The normalized name, since the id derives from it: `Claude` and `claude`
	// are one identity.
	return succeeded('Resolved actor from environment', {
		userId: pinnedId || deriveActorId(name),
		userName: pinnedId ? name : normalize(name),
	});
};

/**
 * Routes a command-line name through `resolveEnvActor`. A conflicting variable
 * is an error, so neither source silently names the author.
 */
export const applyActorNameArgument = (
	name: string,
	source: string,
	env: NodeJS.ProcessEnv = process.env,
): Result<string> => {
	const trimmed = name.trim();

	if (!isValidUserName(trimmed)) {
		return failed(`${source} must be 1-${MAX_NAME_LENGTH} characters of text`);
	}

	const fromEnv = (env[ACTOR_NAME_ENV] ?? '').trim();

	if (fromEnv && normalize(fromEnv) !== normalize(trimmed)) {
		return failed(
			`${source} names ${trimmed}, but ${ACTOR_NAME_ENV} names ${fromEnv}`,
		);
	}

	// Only when the variable doesn't already agree: with `EPIQ_USER_ID` pinned,
	// rewriting its casing would rename that contributor.
	if (!fromEnv) env[ACTOR_NAME_ENV] = trimmed;

	return succeeded('Applied actor name argument', fromEnv || trimmed);
};
