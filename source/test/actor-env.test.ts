import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	ACTOR_ID_ENV,
	ACTOR_NAME_ENV,
	deriveActorId,
	isValidUserId,
	resolveEnvActor,
} from '../lib/config/actor-env.js';
import {loadSettingsFromConfig} from '../lib/config/user-config.js';
import {
	getPersistFileName,
	persist,
	resolveActorId,
} from '../lib/event/event-persist.js';
import {isFail} from '../lib/model/result-types.js';
import {patchSettingsState} from '../lib/state/settings.state.js';

const CONFIGURED = {
	userId: '01KSAYRA4GHEKJP888WFBWBRDD',
	userName: 'jola',
};

const PINNED_ID = '01KTAA6N35EDRBQPSVVZTWM8N0';

describe('resolveEnvActor', () => {
	it('leaves the configured user alone when the environment asks for nothing', () => {
		const result = resolveEnvActor(CONFIGURED, {});

		expect(isFail(result)).toBe(false);
		expect(!isFail(result) && result.value).toBeNull();
	});

	it('derives an actor id from the name', () => {
		const result = resolveEnvActor(CONFIGURED, {[ACTOR_NAME_ENV]: 'claude'});

		expect(isFail(result)).toBe(false);
		expect(!isFail(result) && result.value).toEqual({
			userId: deriveActorId('claude'),
			userName: 'claude',
		});
	});

	// The whole point of deriving rather than minting: one agent is one
	// contributor and one log file, however many times it runs.
	it('derives the same id for the same name, ignoring case and padding', () => {
		expect(deriveActorId('  Claude  ')).toBe(deriveActorId('claude'));
	});

	it('derives an id the persistence layer accepts', () => {
		expect(isValidUserId(deriveActorId('claude'))).toBe(true);
	});

	it('derives different ids for different names', () => {
		expect(deriveActorId('claude')).not.toBe(deriveActorId('codex'));
	});

	it('uses a pinned id instead of deriving one', () => {
		const result = resolveEnvActor(CONFIGURED, {
			[ACTOR_NAME_ENV]: 'claude',
			[ACTOR_ID_ENV]: PINNED_ID,
		});

		expect(!isFail(result) && result.value).toEqual({
			userId: PINNED_ID,
			userName: 'claude',
		});
	});

	it('fails on a malformed pinned id rather than falling back to the configured user', () => {
		const result = resolveEnvActor(CONFIGURED, {
			[ACTOR_NAME_ENV]: 'claude',
			[ACTOR_ID_ENV]: 'not-a-ulid',
		});

		expect(isFail(result)).toBe(true);
	});

	it('fails on an id without a name', () => {
		const result = resolveEnvActor(CONFIGURED, {[ACTOR_ID_ENV]: PINNED_ID});

		expect(isFail(result)).toBe(true);
	});

	it('fails on a name longer than the persistence layer accepts', () => {
		const result = resolveEnvActor(CONFIGURED, {
			[ACTOR_NAME_ENV]: 'a'.repeat(81),
		});

		expect(isFail(result)).toBe(true);
	});

	// Otherwise exporting your own name would fork you into a second
	// contributor holding it.
	it('keeps the configured id when the name is the configured user', () => {
		const result = resolveEnvActor(CONFIGURED, {[ACTOR_NAME_ENV]: 'JOLA '});

		expect(!isFail(result) && result.value).toEqual(CONFIGURED);
	});

	it('is a complete identity on a machine with no configured user', () => {
		const result = resolveEnvActor({}, {[ACTOR_NAME_ENV]: 'claude'});

		expect(!isFail(result) && result.value).toEqual({
			userId: deriveActorId('claude'),
			userName: 'claude',
		});
	});
});

describe('loadSettingsFromConfig', () => {
	const originals = {
		globalDir: process.env['EPIQ_GLOBAL_DIR'],
		name: process.env[ACTOR_NAME_ENV],
		id: process.env[ACTOR_ID_ENV],
	};

	const restore = (name: string, value: string | undefined) => {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	};

	afterEach(() => {
		restore('EPIQ_GLOBAL_DIR', originals.globalDir);
		restore(ACTOR_NAME_ENV, originals.name);
		restore(ACTOR_ID_ENV, originals.id);
	});

	const withConfiguredHome = (): void => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-config-'));

		fs.writeFileSync(
			path.join(home, 'config.json'),
			JSON.stringify({logLevel: 'info', ...CONFIGURED}),
		);

		process.env['EPIQ_GLOBAL_DIR'] = home;
	};

	it('reads the configured user when the environment names nobody', () => {
		withConfiguredHome();
		delete process.env[ACTOR_NAME_ENV];
		delete process.env[ACTOR_ID_ENV];

		const result = loadSettingsFromConfig();

		expect(!isFail(result) && result.value.userId).toBe(CONFIGURED.userId);
		expect(!isFail(result) && result.value.userName).toBe(CONFIGURED.userName);
	});

	it('reads the environment actor over the configured user', () => {
		withConfiguredHome();
		process.env[ACTOR_NAME_ENV] = 'claude';
		delete process.env[ACTOR_ID_ENV];

		const result = loadSettingsFromConfig();

		expect(!isFail(result) && result.value.userId).toBe(
			deriveActorId('claude'),
		);
		expect(!isFail(result) && result.value.userName).toBe('claude');
	});

	// The point of the whole thing: the actor reaches the log, so the events an
	// agent writes are attributed to it and not to whoever owns the config.
	it('persists under the environment actor, not the configured user', () => {
		withConfiguredHome();
		process.env[ACTOR_NAME_ENV] = 'claude';
		delete process.env[ACTOR_ID_ENV];

		const settings = loadSettingsFromConfig();
		if (isFail(settings)) throw new Error(settings.message);
		patchSettingsState(settings.value);

		const actor = resolveActorId();
		if (isFail(actor)) throw new Error(actor.message);

		const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-events-'));
		const written = persist({
			rootDir,
			event: {
				id: '01H00000000000000000000001',
				action: 'edit.title',
				payload: {id: '01H00000000000000000000002', name: 'A title'},
				...actor.value,
			},
		});

		expect(isFail(written)).toBe(false);
		expect(fs.readdirSync(path.join(rootDir, '.epiq', 'events'))).toEqual([
			getPersistFileName(actor.value),
		]);
		expect(getPersistFileName(actor.value)).toBe(
			`${deriveActorId('claude').toLowerCase()}.claude.jsonl`,
		);
	});
});
