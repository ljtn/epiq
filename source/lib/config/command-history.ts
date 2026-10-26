import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {readProjectId} from '../project-setup/project-setup.js';
import {COMMAND_HISTORY_HORIZON} from '../state/cmd.state.js';
import {privateTempDir} from '../storage/private-temp-dir.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';

/**
 * The command line's history, per project, under a private temp dir so a
 * shared `/tmp` doesn't leak ticket refs to other accounts.
 */

export const COMMAND_HISTORY_FILE_NAME = 'command-history.json';

/** Projects kept, most recently used first. Bounds a file nobody prunes. */
export const MAX_COMMAND_HISTORY_PROJECTS = 20;

const ProjectHistorySchema = z.object({
	projectId: z.string().min(1),
	commands: z.array(z.string()),
	lastUsedAt: z.number().finite(),
});

const CommandHistoryFileSchema = z.object({
	projects: z.array(ProjectHistorySchema),
});

type ProjectHistory = z.infer<typeof ProjectHistorySchema>;

export const getCommandHistoryPath = (): Result<string> => {
	const dirResult = privateTempDir();
	if (isFail(dirResult)) return dirResult;

	return succeeded(
		'Resolved command history path',
		path.join(dirResult.value, COMMAND_HISTORY_FILE_NAME),
	);
};

const currentProjectRoot = (): string | null => {
	try {
		const rootResult = resolveClosestEpiqProjectRoot(process.cwd());

		return isFail(rootResult) ? null : rootResult.value;
	} catch {
		// `process.cwd()` throws on a directory that has been removed under the
		// process — a worktree pulled out from under it, say.
		return null;
	}
};

/**
 * Unparsable is replaced; unreadable stops a write, since rewriting would drop
 * every other project's history.
 */
type StoredProjects =
	| {state: 'read'; projects: ProjectHistory[]}
	| {state: 'corrupt'; reason: string};

const readFile = (filePath: string): Result<StoredProjects> => {
	if (!fs.existsSync(filePath)) {
		return succeeded('No command history recorded', {
			state: 'read',
			projects: [],
		});
	}

	let contents: string;

	try {
		contents = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		return failed(
			`Unable to read ${COMMAND_HISTORY_FILE_NAME}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(contents);
	} catch (error) {
		return succeeded('Unparsable command history', {
			state: 'corrupt',
			reason: `Invalid ${COMMAND_HISTORY_FILE_NAME}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		});
	}

	const result = CommandHistoryFileSchema.safeParse(parsed);

	if (!result.success) {
		return succeeded('Command history in an unknown shape', {
			state: 'corrupt',
			reason: `Invalid ${COMMAND_HISTORY_FILE_NAME} shape: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		});
	}

	return succeeded('Read command history', {
		state: 'read',
		projects: result.data.projects,
	});
};

/** The stored history of the project at `root`, newest first; none recorded reads as empty. */
export const readCommandHistory = ({
	root,
}: {
	root: string;
}): Result<string[]> => {
	const projectIdResult = readProjectId(root);
	if (isFail(projectIdResult)) return failed(projectIdResult.message);

	const pathResult = getCommandHistoryPath();
	if (isFail(pathResult)) return pathResult;

	const readResult = readFile(pathResult.value);
	if (isFail(readResult)) return readResult;

	const stored = readResult.value;
	if (stored.state === 'corrupt') return failed(stored.reason);

	const entry = stored.projects.find(
		project => project.projectId === projectIdResult.value,
	);

	return succeeded(
		'Read command history',
		entry?.commands.slice(0, COMMAND_HISTORY_HORIZON) ?? [],
	);
};

/**
 * Stores `commands` as the history of the project at `root` (default: the
 * current one). Whole list, last write wins; a nonsense file is replaced.
 */
export const writeCommandHistory = ({
	commands,
	root = currentProjectRoot(),
	now = Date.now(),
}: {
	commands: string[];
	root?: string | null;
	now?: number;
}): Result<null> => {
	if (root === null) {
		return succeeded('No project; command history not stored', null);
	}

	const projectIdResult = readProjectId(root);
	if (isFail(projectIdResult)) return failed(projectIdResult.message);

	const pathResult = getCommandHistoryPath();
	if (isFail(pathResult)) return pathResult;

	const filePath = pathResult.value;
	const readResult = readFile(filePath);
	if (isFail(readResult)) return readResult;

	const stored = readResult.value;
	const existing = stored.state === 'read' ? stored.projects : [];

	const projects = [
		{
			projectId: projectIdResult.value,
			commands: commands.slice(0, COMMAND_HISTORY_HORIZON),
			lastUsedAt: now,
		},
		...existing.filter(project => project.projectId !== projectIdResult.value),
	]
		.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
		.slice(0, MAX_COMMAND_HISTORY_PROJECTS);

	// Written through a rename: every epiq on the machine shares this one file,
	// and a reader must never catch a half-written one.
	const pendingPath = `${filePath}.${process.pid}.tmp`;

	try {
		fs.writeFileSync(
			pendingPath,
			JSON.stringify({projects}, null, 2) + '\n',
			'utf8',
		);
		fs.renameSync(pendingPath, filePath);
	} catch (error) {
		try {
			fs.rmSync(pendingPath, {force: true});
		} catch {
			// The write is already lost; a temp file left behind is the OS's to
			// clear, and must not become a thrown error in its place.
		}

		return failed(
			`Unable to write ${COMMAND_HISTORY_FILE_NAME}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	return succeeded('Stored command history', null);
};
