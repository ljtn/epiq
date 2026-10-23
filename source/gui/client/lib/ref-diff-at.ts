// A ticket's diff stat at a moment, summed here from its commits: a dragged
// needle answers at once, with no reply to wait for and so nothing to blank.

import {
	RefDiffStat,
	RefDiffStats,
	RefDiffTimeline,
} from '../../../lib/stats/ref-diff-stats.model.js';

/** Every ref's totals over the commits made by `cut`, or all of them when live. */
export const diffStatsAt = (
	timeline: RefDiffTimeline,
	cut: number | null,
): RefDiffStats => {
	const stats: RefDiffStats = {};

	for (const [ref, commits] of Object.entries(timeline)) {
		let stat: RefDiffStat | null = null;

		for (const commit of commits) {
			if (cut !== null && commit.time > cut) continue;

			stat ??= {commits: 0, insertions: 0, deletions: 0};
			stat.commits++;
			stat.insertions += commit.insertions;
			stat.deletions += commit.deletions;
		}

		if (stat) stats[ref] = stat;
	}

	return stats;
};
