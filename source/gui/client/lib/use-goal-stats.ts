// A goal's Stats tab: a ticket's code stats over every ticket in the goal.
// Asked for when the tab opens, and again when the goal's tickets or the cut
// change.

import {useCallback, useEffect, useRef, useState} from 'react';
// Types only, from a module that declares nothing but types.
import {IssueStats} from '../../../lib/stats/issue-stats.model.js';
import {getResultValue} from './gui-state-helper';

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
	// Changes when the goal's tickets do.
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
			payload: asOfTime === null ? {goalId} : {goalId, asOfTime},
		});
	}, [goalId, signature, asOfTime, sendRaw]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'goal:stats:result') return;

		const {goalId: forGoal, result} = message.payload as {
			goalId: string;
			result: {status: string; message: string; value?: IssueStats};
		};

		setStats(prev => {
			if (!prev || prev.goalId !== forGoal) return prev;
			if (result?.status === 'fail') {
				return {...prev, loading: false, error: result.message};
			}
			const next = getResultValue<IssueStats>(result);
			return next ? {...prev, loading: false, error: null, stats: next} : prev;
		});
	}, []);

	return {stats, onMessage};
};
