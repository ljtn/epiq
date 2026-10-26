// What was normal in this repository before the ticket: one `ls-tree` and one
// `cat-file --batch` at the commit before its first, not a tree it's part of.

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
	// Comment share of non-blank lines per language, from a sample; absent, never
	// zero, when unmeasured.
	commentShareByLanguage: Map<string, number>;
};

// A sample, not a census: enough for a stable comparison.
const SAMPLE_PER_LANGUAGE = 40;

// `<mode> blob <sha>\t<path>`
const LS_TREE_LINE = /^\d{6} blob ([0-9a-f]{40})\t(.+)$/;

/**
 * Null when there is no earlier tree (the ticket starts at the root), rather
 * than an empty baseline that would make everything look new.
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

		// Tests are excluded, as they are from the ticket's own share.
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
