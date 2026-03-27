import fs from 'node:fs';
import path from 'node:path';
import {AppEvent} from './event.model.js';

export function loadEventsFromDir(
	dirPath = path.join(process.cwd(), '.epiq', 'events'),
): AppEvent[] {
	try {
		const files = fs.readdirSync(dirPath);
		const logFiles = files.filter(file => file.endsWith('.jsonl'));

		const events: AppEvent[] = [];

		for (const file of logFiles) {
			const fullPath = path.join(dirPath, file);
			const content = fs.readFileSync(fullPath, 'utf8');

			for (const line of content.split('\n')) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				events.push(JSON.parse(trimmed) as AppEvent);
			}
		}

		return events;
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return [];
		}
		throw error;
	}
}
