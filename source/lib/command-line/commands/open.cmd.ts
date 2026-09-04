import os from 'node:os';
import path from 'node:path';
import {
	loadProject,
	refreshProjectInBackground,
} from '../../boot/load-project.js';
import {
	listRecentProjects,
	RecentProject,
	recentProjectName,
} from '../../config/recent-projects.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getCmdArg, replaceCmdInput} from '../../state/cmd.state.js';
import {getState} from '../../state/state.js';
import {resolveClosestEpiqProjectRoot} from '../../storage/paths.js';

const expandHome = (input: string): string =>
	input === '~' || input.startsWith('~/')
		? path.join(os.homedir(), input.slice(1))
		: input;

/**
 * `:open 2` picks from the recent list; anything else is a path, taken from
 * the shell's point of view (relative to cwd, `~` expanded) and allowed to sit
 * inside the project rather than at its root.
 */
export const resolveOpenTarget = (
	arg: string,
	recent: RecentProject[],
): Result<string> => {
	const trimmed = arg.trim();

	if (!trimmed) {
		return failed('Provide a number from the list or a path to a project');
	}

	if (/^\d+$/.test(trimmed)) {
		const entry = recent[Number(trimmed) - 1];
		if (!entry) return failed(`No recent project #${trimmed}`);

		return succeeded('Resolved recent project', entry.root);
	}

	const rootResult = resolveClosestEpiqProjectRoot(
		path.resolve(expandHome(trimmed)),
	);
	if (isFail(rootResult)) {
		return failed(`No epiq project at ${trimmed}`);
	}

	return succeeded('Resolved project path', rootResult.value);
};

export const openProjectCommand = async (): Promise<Result<null>> => {
	const arg = getCmdArg();
	replaceCmdInput('');

	// Loading materialises onto whatever state is live, and nothing upstream
	// stops a keyword the init screen did not offer from being typed.
	if (getState().hasProjectDefinition) {
		return failed('Already in a project; run epiq from another directory');
	}

	const recentResult = listRecentProjects({exclude: process.cwd()});
	const recent = isFail(recentResult) ? [] : recentResult.value;

	const targetResult = resolveOpenTarget(arg, recent);
	if (isFail(targetResult)) return failed(targetResult.message);

	const root = targetResult.value;
	const previousCwd = process.cwd();

	// Everything downstream resolves the project from cwd, so switching means
	// moving there. Undone if the project does not load, so a failed open
	// leaves the screen describing the directory it still stands in.
	try {
		process.chdir(root);
	} catch (error) {
		return failed(
			`Unable to enter ${root}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const loadResult = await loadProject(root);
	if (isFail(loadResult)) {
		process.chdir(previousCwd);
		return failed(loadResult.message);
	}

	refreshProjectInBackground(root);

	return succeeded(`Opened ${recentProjectName(root)}`, null);
};
