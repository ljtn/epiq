// Every ticket's code footprint in one answer, bucketed by the ref each subject
// opens with or an Epiq-Ref line names. Only those commits are diffed.

import {isFail, Result, succeeded} from '../../lib/model/result-types.js';
import {RefDiffTimeline} from '../../lib/stats/ref-diff-stats.model.js';
import {CommitEntry} from '../../lib/commits/commits.js';
import {
	getRefCommitTimeline,
	leadingRef,
} from '../../lib/commits/commit-timeline.js';

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
	const timelineResult = await getRefCommitTimeline(input.repoRoot);
	if (isFail(timelineResult)) return timelineResult;

	return succeeded(
		'Collected commits by ref',
		collectRefDiffTimeline(timelineResult.value),
	);
};
