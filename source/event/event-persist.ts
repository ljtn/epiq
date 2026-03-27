import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {failed, succeeded} from '../lib/command-line/command-types.js';
import {AppEvent} from './event.model.js';

const EPIQ_DIR = '.epiq';
const EVENTS_DIR = 'events';

type PersistSuccess = {
	path: string;
	event: AppEvent;
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

export function persist(event: AppEvent, rootDir = process.cwd()) {
	try {
		const dir = getEventsDir(rootDir);
		const filePath = getEventLogPath(rootDir);

		fs.mkdirSync(dir, {recursive: true});

		const line = `${JSON.stringify(event)}\n`;
		fs.appendFileSync(filePath, line, 'utf8');

		return succeeded<PersistSuccess>('Event persisted', {
			path: filePath,
			event,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown persist error';

		return failed(`Failed to persist event: ${message}`);
	}
}
