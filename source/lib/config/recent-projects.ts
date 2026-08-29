import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {readProjectId} from '../project-setup/project-setup.js';
import {getGlobalConfigDir} from '../storage/global-config-dir.js';
import {hasLocalProjectFile} from '../storage/paths.js';

export const RECENT_PROJECTS_FILE_NAME = 'recent-projects.json';
export const MAX_RECENT_PROJECTS = 20;

const RecentProjectSchema = z.object({
	projectId: z.string().min(1),
	root: z.string().min(1),
	lastOpenedAt: z.number().finite(),
});

const RecentProjectsFileSchema = z.object({
	projects: z.array(RecentProjectSchema),
});

export type RecentProject = z.infer<typeof RecentProjectSchema>;

export const getRecentProjectsPath = (): string =>
	path.join(getGlobalConfigDir(), RECENT_PROJECTS_FILE_NAME);

export const recentProjectName = (root: string): string =>
	path.basename(root) || root;

// `process.cwd()` reports symlinks resolved (macOS's /var → /private/var), so
// comparing a stored root to it has to see through them too.
const canonical = (dir: string): string => {
	const resolved = path.resolve(dir);

	try {
		return fs.realpathSync(resolved);
	} catch {
		return resolved;
	}
};

const byMostRecent = (a: RecentProject, b: RecentProject) =>
	b.lastOpenedAt - a.lastOpenedAt;

// An entry is only worth offering while its directory still hosts the project
// it was recorded for. A re-initialised directory carries a new id and gets
// its own entry the next time it boots.
const isLive = (entry: RecentProject): boolean => {
	if (!hasLocalProjectFile(entry.root)) return false;

	const idResult = readProjectId(entry.root);

	return !isFail(idResult) && idResult.value === entry.projectId;
};

export const readRecentProjects = (): Result<RecentProject[]> => {
	const filePath = getRecentProjectsPath();

	if (!fs.existsSync(filePath)) {
		return succeeded('No recent projects recorded', []);
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (error) {
		return failed(
			`Invalid ${RECENT_PROJECTS_FILE_NAME}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const result = RecentProjectsFileSchema.safeParse(parsed);

	if (!result.success) {
		return failed(
			`Invalid ${RECENT_PROJECTS_FILE_NAME} shape: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		);
	}

	return succeeded('Read recent projects', result.data.projects);
};

const writeRecentProjects = (
	projects: RecentProject[],
): Result<RecentProject[]> => {
	const filePath = getRecentProjectsPath();

	try {
		fs.mkdirSync(path.dirname(filePath), {recursive: true});
		fs.writeFileSync(
			filePath,
			JSON.stringify({projects}, null, 2) + '\n',
			'utf8',
		);
	} catch (error) {
		return failed(
			`Unable to write ${RECENT_PROJECTS_FILE_NAME}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	return succeeded('Recorded recent project', projects);
};

/**
 * Lists the projects still worth offering, most recently opened first. `exclude`
 * drops the project the caller is already in.
 */
export const listRecentProjects = ({exclude}: {exclude?: string} = {}): Result<
	RecentProject[]
> => {
	const readResult = readRecentProjects();
	if (isFail(readResult)) return readResult;

	const excluded = exclude === undefined ? null : canonical(exclude);

	return succeeded(
		'Listed recent projects',
		readResult.value
			.filter(entry => excluded === null || canonical(entry.root) !== excluded)
			.filter(isLive)
			.sort(byMostRecent),
	);
};

/**
 * Upserts `root` as the most recently opened project. The registry is a
 * convenience, so a corrupt file is replaced rather than allowed to block the
 * boot that is recording into it.
 */
export const recordRecentProject = ({
	root,
	now = Date.now(),
}: {
	root: string;
	now?: number;
}): Result<RecentProject[]> => {
	const resolvedRoot = path.resolve(root);

	const projectIdResult = readProjectId(resolvedRoot);
	if (isFail(projectIdResult)) return failed(projectIdResult.message);

	const projectId = projectIdResult.value;
	const readResult = readRecentProjects();
	const existing = isFail(readResult) ? [] : readResult.value;

	const projects = [
		{projectId, root: resolvedRoot, lastOpenedAt: now},
		...existing.filter(
			entry => entry.projectId !== projectId && entry.root !== resolvedRoot,
		),
	]
		.filter(isLive)
		.sort(byMostRecent)
		.slice(0, MAX_RECENT_PROJECTS);

	return writeRecentProjects(projects);
};
