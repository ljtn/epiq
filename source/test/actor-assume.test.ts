import fs from 'node:fs';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {getStateBranchRoot} from '../git/git-storage.js';
import {ACTOR_NAME_ENV, deriveActorId} from '../lib/config/actor-env.js';
import {createDefaultEvents} from '../lib/event/event-boot.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {getPersistFileName} from '../lib/event/event-persist.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';
import {
	assumeActor,
	createIssue,
	listBoards,
	listSwimlanes,
} from '../mcp/epiq-api.js';
import {getEventsFile, setupRepo, useTempHome} from './helpers/git-repo.js';

// Taking a name mid-session works because the actor is resolved per write from
// the environment, never cached at boot.

useTempHome();

const clearActorEnv = () => {
	delete process.env[ACTOR_NAME_ENV];
};

beforeEach(clearActorEnv);
afterEach(clearActorEnv);

describe('assumeActor', () => {
	it('takes the name for the rest of the process', async () => {
		const {repoRoot} = await setupRepo();

		const result = await assumeActor({repoRoot, name: 'claude/peter'});

		expect(isFail(result)).toBe(false);
		expect(!isFail(result) && result.value.userName).toBe('claude/peter');
		expect(!isFail(result) && result.value.userId).toBe(
			deriveActorId('claude/peter'),
		);
		expect(process.env[ACTOR_NAME_ENV]).toBe('claude/peter');
	});

	// The log file name is a lossy storage key — the slash does not survive it —
	// so an unregistered agent would show up as `claude-peter` wherever names are
	// resolved. Registering at assume time is what keeps the announced name and
	// the board's name the same string.
	it('registers the name, because the log file name cannot carry it', async () => {
		expect(
			getPersistFileName({
				userId: deriveActorId('claude/peter'),
				userName: 'claude/peter',
			}),
		).toContain('claude-peter');

		const {repoRoot} = await setupRepo();
		const result = await assumeActor({repoRoot, name: 'claude/peter'});

		expect(!isFail(result) && result.value.registered).toBe(true);

		// Asserted on the log rather than on the returned flag: the flag says what
		// was intended, and this says what was actually written for every replay
		// to read the name back from.
		const branchRoot = getStateBranchRoot({repoRoot});
		if (isFail(branchRoot)) throw new Error(branchRoot.message);

		const written = fs.readFileSync(
			getEventsFile({
				root: branchRoot.value,
				fileName: getPersistFileName({
					userId: deriveActorId('claude/peter'),
					userName: 'claude/peter',
				}),
			}),
			'utf-8',
		);

		expect(written).toContain('create.contributor');
		expect(written).toContain('claude/peter');
	});

	// Idempotent: an agent re-announcing itself must not mint a second
	// contributor for an id that already has one.
	it('registers once, however often the same name is assumed', async () => {
		const {repoRoot} = await setupRepo();

		await assumeActor({repoRoot, name: 'claude/peter'});
		const again = await assumeActor({repoRoot, name: 'claude/peter'});

		expect(!isFail(again) && again.value.registered).toBe(false);
	});

	// A name given at launch is the one the session was told to use; a tool call
	// must not quietly move the session onto another identity mid-stream.
	it('refuses a name that fights the one the server was launched with', async () => {
		process.env[ACTOR_NAME_ENV] = 'claude/peter';

		const {repoRoot} = await setupRepo();
		const result = await assumeActor({repoRoot, name: 'codex/fred'});

		expect(isFail(result)).toBe(true);
		expect(process.env[ACTOR_NAME_ENV]).toBe('claude/peter');
	});

	it('rejects a name that is only whitespace', async () => {
		const {repoRoot} = await setupRepo();

		expect(isFail(await assumeActor({repoRoot, name: '   '}))).toBe(true);
	});

	it('rejects a name past the length the log file name can hold', async () => {
		const {repoRoot} = await setupRepo();

		expect(
			isFail(await assumeActor({repoRoot, name: 'c/'.padEnd(200, 'x')})),
		).toBe(true);
	});

	// The point of the whole feature: not that the tool reports a name, but that
	// the next thing written to the board is signed with it.
	it('signs the writes that follow, not just its own answer', async () => {
		const {repoRoot} = await setupRepo();

		const assumed = await assumeActor({repoRoot, name: 'claude/peter'});
		if (isFail(assumed)) throw new Error(assumed.message);

		const branchRoot = getStateBranchRoot({repoRoot});
		if (isFail(branchRoot)) throw new Error(branchRoot.message);

		// A board to file against. Written as the agent, which is also what a real
		// project has: whoever ran init is a contributor from the first event.
		const defaults = createDefaultEvents(assumed.value);
		if (isFail(defaults)) throw new Error(defaults.message);

		const seeded = materializeAndPersistAll(
			[...defaults.value] as AppEvent[],
			branchRoot.value,
		);
		if (isFail(seeded)) throw new Error(seeded.message);

		const boards = await listBoards({repoRoot});
		if (isFail(boards)) throw new Error(boards.message);

		const swimlanes = await listSwimlanes({
			repoRoot,
			boardId: boards.value[0]!.id,
		});
		if (isFail(swimlanes)) throw new Error(swimlanes.message);

		const created = await createIssue({
			repoRoot,
			title: 'written by the agent',
			parentId: swimlanes.value[0]!.id,
		});
		if (isFail(created)) throw new Error(created.message);

		// Attribution is the file the event landed in: the actor id is parsed back
		// out of the log's name, never carried in the payload.
		const agentLog = fs.readFileSync(
			getEventsFile({
				root: branchRoot.value,
				fileName: getPersistFileName(assumed.value),
			}),
			'utf-8',
		);

		expect(agentLog).toContain('written by the agent');
		expect(assumed.value.userId).toBe(deriveActorId('claude/peter'));
	});
});
