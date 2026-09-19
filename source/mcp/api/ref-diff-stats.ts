// Every ticket's code footprint, in one answer.
//
// The board draws a bar beside each ref, so the per-ticket reader
// (`getCommitsForRef`) is the wrong shape here — a column of forty cards would
// be forty calls. This walks the same history scan those calls share, once,
// and buckets it by the ref each subject opens with. No `git` of its own:
// `getCommitTimeline` is a single `--shortstat` log, cached, and already read
// by the scrubber moments earlier.

import {isFail, Result, succeeded} from '../../lib/model/result-types.js';
import {
	RefDiffStat,
	RefDiffStats,
} from '../../lib/stats/ref-diff-stats.model.js';
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

export const collectRefDiffStats = (
	commits: readonly CommitEntry[],
): RefDiffStats => {
	const byRef: RefDiffStats = {};

	for (const commit of commits) {
		const ref = leadingRef(commit.subject);
		if (!ref) continue;

		const stat: RefDiffStat = (byRef[ref] ??= {
			commits: 0,
			insertions: 0,
			deletions: 0,
		});

		stat.commits++;
		stat.insertions += commit.insertions;
		stat.deletions += commit.deletions;
	}

	return byRef;
};

export const getRefDiffStats = async (
	input: {repoRoot?: string} = {},
): Promise<Result<RefDiffStats>> => {
	const timelineResult = await getCommitTimeline({repoRoot: input.repoRoot});
	if (isFail(timelineResult)) return timelineResult;

	return succeeded(
		'Collected diff stats by ref',
		collectRefDiffStats(timelineResult.value),
	);
};
