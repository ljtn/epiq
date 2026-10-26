// A goal's Stats tab: a ticket's code stats over every ticket in the goal.
// Asked for when the tab opens, and again when the goal's tickets, their
// commits or the cut change.

import {useCallback, useEffect, useRef, useState} from 'react';
// Types only, from modules that declare nothing but types.
import {IssueStats} from '../../../lib/stats/issue-stats.model.js';
import {RefDiffStats} from '../../../lib/stats/ref-diff-stats.model.js';
import {GuiBoard} from './gui-state.model';
import {getResultValue} from './gui-state-helper';

/** Which tickets a goal holds, and what each one's commits add up to. */
export const goalStatsSignature = (
	goalId: string,
	boards: GuiBoard[],
	diffStats: RefDiffStats,
): string => {
	const members = new Set(
		boards.flatMap(
			board =>
				board.goals
					.find(goal => goal.id === goalId)
					?.members.map(member => member.id) ?? [],
		),
	);
	return boards
		.flatMap(board => board.swimlanes.flatMap(lane => lane.issues))
		.filter(issue => members.has(issue.id))
		.map(issue => {
			const diff = diffStats[issue.ref];
			return `${issue.id}:${diff?.commits ?? 0}:${diff?.insertions ?? 0}:${
				diff?.deletions ?? 0
			}`;
		})
		.sort()
		.join(',');
};

export type GoalStatsState = {
	goalId: string;
	loading: boolean;
	error: string | null;
	stats: IssueStats | null;
};

export const useGoalStats = ({
	goalId,
	signature,
	asOfTime,
	sendRaw,
}: {
	// Null while the tab is closed.
	goalId: string | null;
	// From goalStatsSignature.
	signature: string;
	asOfTime: number | null;
	sendRaw: (message: unknown) => void;
}) => {
	const [stats, setStats] = useState<GoalStatsState | null>(null);
	const asked = useRef<string | null>(null);

	useEffect(() => {
		if (!goalId) {
			setStats(null);
			asked.current = null;
			return;
		}

		const key = `${goalId} ${signature} ${asOfTime ?? ''}`;
		if (asked.current === key) return;
		asked.current = key;

		// The last figures stay up while new ones are on their way.
		setStats(prev => ({
			goalId,
			loading: true,
			error: null,
			stats: prev?.goalId === goalId ? prev.stats : null,
		}));
		sendRaw({
			type: 'goal:stats:get',
			payload: asOfTime === null ? {goalId, key} : {goalId, key, asOfTime},
		});
	}, [goalId, signature, asOfTime, sendRaw]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'goal:stats:result') return;

		const {key, result} = message.payload as {
			key: string;
			result: {status: string; message: string; value?: IssueStats};
		};
		// An answer to anything but the latest ask is already out of date.
		if (key !== asked.current) return;

		setStats(prev => {
			if (!prev) return prev;
			if (result?.status === 'fail') {
				return {...prev, loading: false, error: result.message};
			}
			const next = getResultValue<IssueStats>(result);
			return next ? {...prev, loading: false, error: null, stats: next} : prev;
		});
	}, []);

	return {stats, onMessage};
};
