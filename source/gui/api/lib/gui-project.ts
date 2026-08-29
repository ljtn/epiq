import {
	listRecentProjects,
	recentProjectName,
} from '../../../lib/config/recent-projects.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../../lib/model/result-types.js';

// The project a GUI server is serving. Mutable so `project:open` can point a
// server started outside any project at one from the recent list.
export type GuiProject = {repoRoot: string};

export type RecentProjectView = {
	projectId: string;
	name: string;
	root: string;
	lastOpenedAt: number;
};

export const recentProjectViews = (exclude: string): RecentProjectView[] => {
	const result = listRecentProjects({exclude});
	if (isFail(result)) return [];

	return result.value.map(entry => ({
		projectId: entry.projectId,
		name: recentProjectName(entry.root),
		root: entry.root,
		lastOpenedAt: entry.lastOpenedAt,
	}));
};

// Only a root the registry currently lists: the socket is origin-guarded, but
// a message still should not be able to aim the server at an arbitrary path.
export const resolveRecentProjectRoot = (root: string): Result<string> => {
	const result = listRecentProjects();
	if (isFail(result)) return failed(result.message);

	const entry = result.value.find(candidate => candidate.root === root);
	if (!entry) return failed(`Not a recent project: ${root}`);

	return succeeded('Resolved recent project', entry.root);
};
