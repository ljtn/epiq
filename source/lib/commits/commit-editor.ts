import {existsSync} from 'node:fs';
import {chmod} from 'node:fs/promises';
import path from 'node:path';
import {execGit} from '../../git/git-utils.js';
import {
	getEditorCandidates,
	isVSCodeEditor,
	openEditorDiffNonBlocking,
	openEditorOnFileNonBlocking,
} from '../editor/editor.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {fileManager} from '../storage/file-manager.js';
import {privateTempDir} from '../storage/private-temp-dir.js';
import {isPlausibleSha, RepoInput, resolveRepoRoot} from './commit-repo.js';

// Fallback: editors highlight the +/- lines but not the code's own language.
const openCommitAsUnifiedDiff = async (
	repoRoot: string,
	sha: string,
): Promise<Result<true>> => {
	const showResult = await execGit({cwd: repoRoot, args: ['show', sha]});
	if (isFail(showResult)) return failed(showResult.message);

	const tmpDirResult = privateTempDir('commit-diffs');
	if (isFail(tmpDirResult)) return failed(tmpDirResult.message);

	const tmpPath = path.join(tmpDirResult.value, `${sha}.diff`);

	// Already chmod 0o444 after the first write, so re-writing would fail EACCES.
	if (!existsSync(tmpPath)) {
		fileManager.writeToFile(tmpPath, showResult.value.stdout);
		await chmod(tmpPath, 0o444);
	}

	return openEditorOnFileNonBlocking(tmpPath);
};

// Beyond this, dozens of tabs (one editor spawn each) is worse than one diff.
const MAX_DIFF_FILES_FOR_SIDE_BY_SIDE = 12;

// No CLI signal for "the new window is up", so just long enough to outlast it.
const NEW_WINDOW_SETTLE_MS = 800;

// A missing blob only means the file was added or deleted here, not a failure.
const readFileAtRevision = async (
	repoRoot: string,
	revision: string,
	filePath: string,
): Promise<string> => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['show', `${revision}:${filePath}`],
	});

	return isFail(result) ? '' : result.value.stdout;
};

// Shared by the editor path below and by getCommitDiff's data path. A plain
// two-tree diff against the first parent (matching readFileAtRevision's own
// `sha~1` convention) rather than `diff-tree -r <sha>`: diff-tree's single-
// commit mode reports no files at all for a merge commit unless told
// otherwise, which read as "no changes" instead of the merge's real diff.
const getChangedFilePaths = async (
	repoRoot: string,
	sha: string,
): Promise<Result<string[]>> => {
	const filesResult = await execGit({
		cwd: repoRoot,
		args: ['diff', '--name-only', `${sha}~1`, sha],
	});
	if (isFail(filesResult)) return failed(filesResult.message);

	const filePaths = filesResult.value.stdout
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);

	if (filePaths.length === 0) {
		return failed('No changed files found for this commit');
	}

	return succeeded('Listed changed files', filePaths);
};

// Each side keeps its real filename so the editor detects the language.
const openCommitAsSideBySideDiffs = async (
	repoRoot: string,
	sha: string,
	editor: string,
): Promise<Result<true>> => {
	const filesResult = await getChangedFilePaths(repoRoot, sha);
	if (isFail(filesResult)) return failed(filesResult.message);

	const filePaths = filesResult.value;

	if (filePaths.length > MAX_DIFF_FILES_FOR_SIDE_BY_SIDE) {
		return failed(
			`Commit touches ${filePaths.length} files — too many for a side-by-side view`,
		);
	}

	// Locks the whole `epiq/commit-diffs` chain down, so the per-file
	// directories written under it below inherit a parent nobody else can enter.
	const tmpDirResult = privateTempDir('commit-diffs', sha);
	if (isFail(tmpDirResult)) return failed(tmpDirResult.message);

	const tmpDir = tmpDirResult.value;

	const preparedFiles = await Promise.all(
		filePaths.map(async (filePath, index) => {
			const [beforeContent, afterContent] = await Promise.all([
				readFileAtRevision(repoRoot, `${sha}~1`, filePath),
				readFileAtRevision(repoRoot, sha, filePath),
			]);

			// Indexed so same-named files from different directories don't collide.
			const basename = path.basename(filePath);
			const beforePath = path.join(tmpDir, String(index), 'before', basename);
			const afterPath = path.join(tmpDir, String(index), 'after', basename);

			if (!existsSync(beforePath)) {
				fileManager.writeToFile(beforePath, beforeContent);
				await chmod(beforePath, 0o444);
			}

			if (!existsSync(afterPath)) {
				fileManager.writeToFile(afterPath, afterContent);
				await chmod(afterPath, 0o444);
			}

			return {beforePath, afterPath};
		}),
	);

	// Must be sequenced: the first tab forces a new window, and the rest reuse
	// whichever window is active — after the settle delay below, that new one.
	const [first, ...rest] = preparedFiles;
	if (!first) return failed('No changed files found for this commit');

	const firstResult = await openEditorDiffNonBlocking(
		editor,
		first.beforePath,
		first.afterPath,
		'new',
	);
	if (isFail(firstResult) || rest.length === 0) return firstResult;

	await new Promise(resolve => setTimeout(resolve, NEW_WINDOW_SETTLE_MS));

	const restResults = await Promise.all(
		rest.map(({beforePath, afterPath}) =>
			openEditorDiffNonBlocking(editor, beforePath, afterPath, 'reuse'),
		),
	);

	for (const result of restResults) {
		if (isFail(result)) {
			logger.error(
				`Failed to open an additional diff tab for ${sha}: ${result.message}`,
			);
		}
	}

	return firstResult;
};

// Never touches the materialized state singleton, so it is independent of any
// time-travel checkout.
export const openCommitDiffInEditor = async (
	input: RepoInput & {sha: string},
): Promise<Result<true>> => {
	if (!isPlausibleSha(input.sha)) return failed('Invalid commit sha');

	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	const primaryEditor = getEditorCandidates()[0];

	if (primaryEditor && isVSCodeEditor(primaryEditor)) {
		const sideBySideResult = await openCommitAsSideBySideDiffs(
			repoRoot,
			input.sha,
			primaryEditor,
		);

		if (!isFail(sideBySideResult)) return sideBySideResult;

		logger.error(
			`Side-by-side diff failed for ${input.sha}, falling back to unified diff: ${sideBySideResult.message}`,
		);
	}

	return openCommitAsUnifiedDiff(repoRoot, input.sha);
};
