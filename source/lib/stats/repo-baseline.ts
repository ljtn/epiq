// What was normal in this repository before the ticket started.
//
// A stat about a diff is only ever half a sentence: 6% comment lines, 0.4
// tests per line of code — compared with what? These reads answer the other
// half from the repository's own history, so the comparison is against the
// codebase somebody is actually working in rather than an invented target.

import {execGitAllowFail} from '../../git/git-utils.js';
import {isGeneratedPath, languageOf} from './file-kinds.js';

/**
 * Every language present in the tree one commit before `sha`.
 *
 * Null — not an empty set — when there is no such tree: a ticket whose first
 * commit is the repository's own root has no "before", and calling that "no
 * languages" would report every language in the change as newly introduced.
 */
export const readLanguagesBefore = async ({
	repoRoot,
	sha,
}: {
	repoRoot: string;
	sha: string;
}): Promise<Set<string> | null> => {
	const result = await execGitAllowFail({
		cwd: repoRoot,
		args: ['ls-tree', '-r', '--name-only', `${sha}~1`],
	});

	if (result.exitCode !== 0) return null;

	const languages = new Set<string>();

	for (const path of result.stdout.split('\n')) {
		if (!path || isGeneratedPath(path)) continue;

		languages.add(languageOf(path));
	}

	return languages;
};
