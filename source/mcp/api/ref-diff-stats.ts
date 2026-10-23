// Every ticket's code footprint, in one answer.
//
// The board draws a bar beside each ref, so the per-ticket reader
// (`getCommitsForRef`) is the wrong shape here — a column of forty cards would
// be forty calls. This walks the same history scan those calls share, once,
// and buckets it by the ref each subject opens with. No `git` of its own:
// `getCommitTimeline` is a single `--shortstat` log, cached, and already read
// by the scrubber moments earlier.

import {isFail, Result, succeeded} from '../../lib/model/result-types.js';
import {RefDiffTimeline} from '../../lib/stats/ref-diff-stats.model.js';
import {NODE_REF_LENGTH} from '../../lib/utils/node-ref.js';
import {CommitEntry, getCommitTimeline} from '../../lib/commits/commits.js';

// Crockford base32 leaves out I, L, O and U, but this matches the same shape
// `getCommitsForRef` does — a bare prefix of the right length, case-insensitive
// — rather than a stricter one, so the two never disagree about a commit. A
// word that happens to look like a ref just buckets under a ref no ticket owns,
// and nothing ever asks for it.
const REF_TOKEN = new RegExp(`^[0-9A-Z]{${NODE_REF_LENGTH}}$`);

/** The ref a subject names, or null — `"5S52AC8 message"` -> `"5S52AC8"`. */
const leadingRef = (subject: string): string | null => {
	const space = subject.indexOf(' ');
	if (space === -1) return null;

	const token = subject.slice(0, space).toUpperCase();

	return REF_TOKEN.test(token) ? token : null;
};

export const collectRefDiffTimeline = (
	commits: readonly CommitEntry[],
): RefDiffTimeline => {
	const byRef: RefDiffTimeline = {};

	for (const commit of commits) {
		const leading = leadingRef(commit.subject);
		const refs = new Set([
			...(leading ? [leading] : []),
			...(commit.refs ?? []),
		]);

		for (const ref of refs) {
			(byRef[ref] ??= []).push({
				time: commit.time,
				insertions: commit.insertions,
				deletions: commit.deletions,
			});
		}
	}

	return byRef;
};

export const getRefDiffTimeline = async (
	input: {repoRoot?: string} = {},
): Promise<Result<RefDiffTimeline>> => {
	const timelineResult = await getCommitTimeline({repoRoot: input.repoRoot});
	if (isFail(timelineResult)) return timelineResult;

	return succeeded(
		'Collected commits by ref',
		collectRefDiffTimeline(timelineResult.value),
	);
};
