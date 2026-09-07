// What was normal in this repository before the ticket started.
//
// A stat about a diff is only ever half a sentence: 6% comment lines, 0.4
// tests per line of code — compared with what? This reads the other half from
// the repository's own history, so the comparison is against the codebase
// somebody is actually working in rather than an invented target.
//
// One `ls-tree` and one `cat-file --batch` answer both halves, at the commit
// *before* the ticket's first: comparing a change against a tree it is
// already part of would flatten exactly the difference being looked for.

import {execGitAllowFail, readGitBlobsBatch} from '../../git/git-utils.js';
import {isFail} from '../model/result-types.js';
import {classifyLine} from './comment-density.js';
import {
	commentSyntaxOf,
	isGeneratedPath,
	isTestPath,
	languageOf,
} from './file-kinds.js';

export type RepoBaseline = {
	languages: Set<string>;
	// Comment share of non-blank lines, per language, from a sample of the
	// files that were there. Absent for a language the sample could not
	// measure — never defaulted to zero, which would read as "this repo does
	// not comment".
	commentShareByLanguage: Map<string, number>;
};

// A sample, not a census: the point is a number to compare against, and the
// difference between reading forty files and four thousand is milliseconds
// against seconds for a digit that does not move.
const SAMPLE_PER_LANGUAGE = 40;

// `<mode> blob <sha>\t<path>`
const LS_TREE_LINE = /^\d{6} blob ([0-9a-f]{40})\t(.+)$/;

/**
 * Null — not an empty baseline — when there is no earlier tree to read: a
 * ticket whose first commit is the repository's root has no "before", and
 * calling that "no languages, no comments" would report every language in the
 * change as newly introduced and every comment share as an improvement.
 */
export const readRepoBaseline = async ({
	repoRoot,
	sha,
}: {
	repoRoot: string;
	sha: string;
}): Promise<RepoBaseline | null> => {
	const listing = await execGitAllowFail({
		cwd: repoRoot,
		args: ['-c', 'core.quotePath=false', 'ls-tree', '-r', `${sha}~1`],
	});

	if (listing.exitCode !== 0) return null;

	const languages = new Set<string>();
	const sampleByLanguage = new Map<string, {blob: string; path: string}[]>();

	for (const line of listing.stdout.split('\n')) {
		const match = LS_TREE_LINE.exec(line);
		if (!match) continue;

		const [, blob = '', path = ''] = match;
		if (isGeneratedPath(path)) continue;

		const name = languageOf(path);
		languages.add(name);

		// Tests are excluded from the comment baseline for the same reason the
		// ticket's own test lines are: test files comment differently, and a
		// repo's test-to-code mix would otherwise decide the number a feature
		// change is compared against.
		if (isTestPath(path) || !commentSyntaxOf(path)) continue;

		const sample = sampleByLanguage.get(name) ?? [];
		if (sample.length < SAMPLE_PER_LANGUAGE) {
			sample.push({blob, path});
			sampleByLanguage.set(name, sample);
		}
	}

	const sampled = [...sampleByLanguage.values()].flat();
	const blobsResult = await readGitBlobsBatch(
		sampled.map(entry => entry.blob),
		repoRoot,
	);

	// A baseline that could not be read is still a baseline for the language
	// set, which came from the listing alone.
	if (isFail(blobsResult)) {
		return {languages, commentShareByLanguage: new Map()};
	}

	const blobs = blobsResult.value;
	const counts = new Map<string, {comment: number; code: number}>();

	for (const {blob, path} of sampled) {
		const content = blobs.get(blob);
		if (content === undefined) continue;

		const syntax = commentSyntaxOf(path);
		const name = languageOf(path);
		const entry = counts.get(name) ?? {comment: 0, code: 0};

		for (const line of content.split('\n')) {
			const kind = classifyLine(line, syntax);
			if (kind === 'comment') entry.comment++;
			if (kind === 'code') entry.code++;
		}

		counts.set(name, entry);
	}

	const commentShareByLanguage = new Map<string, number>();

	for (const [name, entry] of counts) {
		const nonBlank = entry.comment + entry.code;
		if (nonBlank > 0)
			commentShareByLanguage.set(name, entry.comment / nonBlank);
	}

	return {languages, commentShareByLanguage};
};
