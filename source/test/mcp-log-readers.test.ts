import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

// The MCP keeps the board, not the log: a tool that reads the whole log, or
// the app-wide event list, undoes that for every agent. Each one here is
// either the GUI's alone or let go of at once.
const ALLOWED: Record<string, {reads: string[]; why: string}> = {
	'mcp/api/contributors.ts': {
		reads: ['loadMergedEvents'],
		why: 'board-scoped list: a transient load, let go of after',
	},
	'mcp/api/issues.ts': {
		reads: ['.eventLog'],
		why: 'getIssueHistory: the GUI history panel only',
	},
	'mcp/api/personal-stats.ts': {
		reads: ['.eventLog'],
		why: 'GUI only, and refuses in a process keeping no events',
	},
	'mcp/api/state.ts': {
		reads: ['.eventLog', 'bootStateFromEventLog'],
		why: 'the GUI board payload only; the boot is named in a comment',
	},
	'mcp/epiq-time-travel.ts': {
		reads: ['loadMergedEvents', 'loadOrderedEntries'],
		why: 'time travel: the GUI only',
	},
	'mcp/timeline-index.ts': {
		reads: ['loadMergedEvents'],
		why: 'the timeline: the GUI only',
	},
};

const READS_THE_LOG =
	/\b(loadMergedEvents|loadMergedEventsWithUnreadable|loadOrderedEntries|bootStateFromEventLog)\b|\.eventLog\b/g;

const sourcesUnder = (dir: string): string[] =>
	fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
		const at = path.join(dir, entry.name);
		if (entry.isDirectory())
			return entry.name === 'test' ? [] : sourcesUnder(at);
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
			? [at]
			: [];
	});

describe('what the MCP reads of the log', () => {
	it('is the whole log or the event list only where that is known and let go of', () => {
		const root = path.resolve('source');
		const readers = Object.fromEntries(
			sourcesUnder(path.join(root, 'mcp'))
				// The export list names them; it reads nothing.
				.filter(file => file !== path.join(root, 'mcp', 'epiq-api.ts'))
				.map((file): [string, string[]] => [
					path.relative(root, file),
					[
						...new Set(
							fs.readFileSync(file, 'utf8').match(READS_THE_LOG) ?? [],
						),
					].sort(),
				])
				.filter(([, reads]) => reads.length > 0),
		);

		expect(readers).toEqual(
			Object.fromEntries(
				Object.entries(ALLOWED).map(([file, {reads}]) => [
					file,
					[...reads].sort(),
				]),
			),
		);
	});
});
