import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
	parsePersistedEvent,
	persist,
	resolveEpiqRoot,
	toPersistedEvent,
} from '../event/event-persist.js';
import {AppEvent, StoredAppEvent} from '../event/event.model.js';
import {isFail} from '../lib/command-line/command-types.js';

const makeTempDir = (): string =>
	fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-'));

const event = (overrides: Partial<AppEvent> = {}): AppEvent =>
	({
		id: 'event-1',
		userId: 'u1',
		userName: 'alice',
		action: 'init.workspace',
		payload: {
			id: 'workspace-1',
			name: 'Workspace',
		},
		...overrides,
	} as AppEvent);

describe('event persist', () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = makeTempDir();
		fs.mkdirSync(path.join(rootDir, '.epiq'), {recursive: true});
	});

	it('parses a valid persisted event', () => {
		const result = parsePersistedEvent({
			v: 1,
			id: ['01H00000000000000000000001', null],
			'init.workspace': {
				id: 'workspace-1',
				name: 'Workspace',
			},
		});

		expect(isFail(result)).toBe(false);
	});

	it('fails parsing when persisted event is missing version', () => {
		const result = parsePersistedEvent({
			id: ['01H00000000000000000000001', null],
			'init.workspace': {
				id: 'workspace-1',
				name: 'Workspace',
			},
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('Invalid persisted event');
		}
	});

	it('fails parsing when persisted event has invalid composite id', () => {
		const result = parsePersistedEvent({
			v: 1,
			id: 'not-composite',
			'init.workspace': {
				id: 'workspace-1',
				name: 'Workspace',
			},
		});

		expect(isFail(result)).toBe(true);
	});

	it('converts stored event to persisted event', () => {
		const stored: StoredAppEvent = {
			action: 'init.workspace',
			payload: {
				id: 'workspace-1',
				name: 'Workspace',
			},
		} as StoredAppEvent;

		const result = toPersistedEvent(stored, [
			'01H00000000000000000000001',
			null,
		]);

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.data.v).toBe(1);
			expect(result.data.id).toEqual(['01H00000000000000000000001', null]);
			expect(result.data).toHaveProperty('init.workspace');
		}
	});

	it('resolves nearest parent directory containing .epiq', () => {
		const nested = path.join(rootDir, 'a', 'b', 'c');
		fs.mkdirSync(nested, {recursive: true});

		expect(resolveEpiqRoot(nested)).toBe(rootDir);
	});

	it('falls back to start directory when no .epiq directory exists', () => {
		const dir = makeTempDir();

		expect(resolveEpiqRoot(dir)).toBe(dir);

		fs.rmSync(dir, {recursive: true, force: true});
	});

	it('persists event to sanitized actor event file', () => {
		const result = persist({event: event(), rootDir});

		expect(isFail(result)).toBe(false);

		const filePath = path.join(rootDir, '.epiq', 'events', 'u1.alice.jsonl');

		expect(fs.existsSync(filePath)).toBe(true);

		const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
		expect(lines).toHaveLength(1);

		const parsed = JSON.parse(lines[0] ?? '{}');

		expect(parsed.v).toBe(1);
		expect(parsed.id[0]).toEqual(expect.any(String));
		expect(parsed.id[1]).toBe(null);
		expect(parsed['init.workspace']).toEqual({
			id: 'workspace-1',
			name: 'Workspace',
		});
	});

	it('uses previous edge ref as composite id ref on subsequent persists', () => {
		const first = persist({event: event({id: 'event-1'}), rootDir});
		expect(isFail(first)).toBe(false);

		const second = persist({
			event: event({
				id: 'event-2',
				payload: {
					id: 'workspace-2',
					name: 'Workspace 2',
				},
			}),
			rootDir,
		});

		expect(isFail(second)).toBe(false);

		const filePath = path.join(rootDir, '.epiq', 'events', 'u1.alice.jsonl');

		const [firstLine, secondLine] = fs
			.readFileSync(filePath, 'utf8')
			.trim()
			.split('\n')
			.map(line => JSON.parse(line));

		expect(secondLine.id[1]).toBe(firstLine.id[0]);
	});
});
