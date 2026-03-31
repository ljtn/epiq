import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {failed, succeeded} from '../lib/command-line/command-types.js';
import {AppEvent} from './event.model.js';
import {ulid} from 'ulid';

const EPIQ_DIR = '.epiq';
const EVENTS_DIR = 'events';

export type PersistedEvent = {
	eventId: string;
	actorId: string;
	persistedAt: string;
	event: AppEvent;
};

type PersistSuccess = {
	path: string;
	entry: PersistedEvent;
};

const sanitizeFilePart = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'unknown';

const resolveActorId = () => {
	const explicit = process.env['EPIQ_ACTOR_ID'];
	if (explicit?.trim()) return sanitizeFilePart(explicit);

	const envUser =
		process.env['GIT_AUTHOR_NAME'] ||
		process.env['GIT_COMMITTER_NAME'] ||
		process.env['USER'] ||
		process.env['USERNAME'];

	if (envUser?.trim()) return sanitizeFilePart(envUser);

	try {
		return sanitizeFilePart(os.userInfo().username);
	} catch {
		return 'unknown';
	}
};

const getEventsDir = (rootDir = process.cwd()) =>
	path.join(rootDir, EPIQ_DIR, EVENTS_DIR);

export const getEventLogPath = (rootDir = process.cwd()) => {
	const actorId = resolveActorId();
	return path.join(getEventsDir(rootDir), `${actorId}.jsonl`);
};

const parseJsonLine = (line: string): PersistedEvent | null => {
	const trimmed = line.trim();
	if (!trimmed) return null;
	return JSON.parse(trimmed) as PersistedEvent;
};

const readLatestEntry = (filePath: string): PersistedEvent | null => {
	if (!fs.existsSync(filePath)) return null;

	const content = fs.readFileSync(filePath, 'utf8');
	if (!content.trim()) return null;

	const lines = content.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		const entry = parseJsonLine(lines[i] ?? '');
		if (entry) return entry;
	}

	return null;
};

const readLatestGlobalEventId = (rootDir = process.cwd()): string | null => {
	const dir = getEventsDir(rootDir);
	if (!fs.existsSync(dir)) return null;

	const files = fs
		.readdirSync(dir)
		.filter(file => file.endsWith('.jsonl'))
		.map(file => path.join(dir, file));

	let latest: string | null = null;

	for (const filePath of files) {
		const entry = readLatestEntry(filePath);
		if (!entry) continue;

		if (latest === null || entry.eventId > latest) {
			latest = entry.eventId;
		}
	}

	return latest;
};

export function persist(event: AppEvent, rootDir = process.cwd()) {
	try {
		const actorId = resolveActorId();
		const dir = getEventsDir(rootDir);
		const filePath = getEventLogPath(rootDir);

		fs.mkdirSync(dir, {recursive: true});

		const entry: PersistedEvent = {
			eventId: ulid(),
			actorId,
			persistedAt: new Date().toISOString(),
			event,
		};

		fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');

		return succeeded<PersistSuccess>('Event persisted', {
			path: filePath,
			entry,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown persist error';

		return failed(`Failed to persist event: ${message}`);
	}
}
