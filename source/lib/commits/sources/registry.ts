// Turning a source id into something git can be pointed at.
//
// The board's own repository is the source `self`, read in place in the
// working checkout; every other source is a bare clone epiq keeps under
// `.epiq/sources/`. Both resolve to the same shape — a directory to run git
// in, plus the branch to exclude for `self` — so every read in `lib/commits`
// holds one code path for all of them, with no special case at the call
// sites.
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {readProjectFile} from '../../project-setup/project-setup.js';
import {
	getSourcesDirPath,
	resolveClosestEpiqProjectRoot,
} from '../../storage/paths.js';
import {SELF_SOURCE_ID, SourceSpec} from './source-spec.js';

export type SourceRef = {
	id: string;
	// 'self': the board's own repository, read in place. 'clone': epiq's own
	// bare clone of a registered remote.
	kind: 'self' | 'clone';
	// The directory every git read for this source runs in.
	gitPath: string;
	// Present only for 'self': the branch epiq writes its state to, whose
	// commits are not development history and so are excluded from `git log`.
	stateBranch?: string;
};

/** The sources a project file registers, in file order. */
export const listSourceSpecs = (repoRoot: string): Result<SourceSpec[]> => {
	const projectResult = readProjectFile(repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	return succeeded(
		'Listed registered sources',
		projectResult.value.sources ?? [],
	);
};

/**
 * Where a source's history is read on this machine.
 *
 * `sourceId` omitted or `"self"` answers the board's own repository. Any
 * other id must be registered in `project.json`; an unregistered one is a
 * failure naming the sources that are, rather than an empty answer that
 * would read as "no commits".
 *
 * A clone is resolved whether or not it exists on disk yet — creating and
 * fetching clones is a later phase, and a read of a clone that is not there
 * fails in git's own words ("Git cwd does not exist"), which says where to
 * look better than a second message here would.
 */
export const resolveSourceRef = (
	input: {repoRoot?: string; sourceId?: string} = {},
): Result<SourceRef> => {
	const rootResult = resolveClosestEpiqProjectRoot(
		input.repoRoot ?? process.cwd(),
	);
	if (isFail(rootResult)) return failed(rootResult.message);

	const repoRoot = rootResult.value;

	const projectResult = readProjectFile(repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	if (input.sourceId === undefined || input.sourceId === SELF_SOURCE_ID) {
		return succeeded('Resolved the board repository source', {
			id: SELF_SOURCE_ID,
			kind: 'self',
			gitPath: repoRoot,
			stateBranch: projectResult.value.stateBranch,
		});
	}

	const specsResult = listSourceSpecs(repoRoot);
	if (isFail(specsResult)) return failed(specsResult.message);

	const spec = specsResult.value.find(source => source.id === input.sourceId);
	if (!spec) {
		const known = specsResult.value.map(source => source.id);
		return failed(
			`No source "${input.sourceId}" in project.json` +
				(known.length > 0 ? ` (registered: ${known.join(', ')})` : ''),
		);
	}

	return succeeded('Resolved a registered source', {
		id: spec.id,
		kind: 'clone',
		gitPath: getClonePath(repoRoot, spec.id),
	});
};

/** `<repoRoot>/.epiq/sources/<id>.git` — a bare clone path, never a worktree. */
export const getClonePath = (repoRoot: string, sourceId: string): string =>
	path.join(getSourcesDirPath(repoRoot), `${sourceId}.git`);
