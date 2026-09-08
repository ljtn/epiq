// What the swimlane panel needs that the board's own state does not carry: the
// lane's traffic, and what the code on the tickets standing in it adds up to.
// One fetch, one reply, thrown away when the lane changes.

import {useCallback, useEffect, useState} from 'react';
// Types only, from a module that declares nothing but types and imports
// nothing at all — the same boundary `use-issue-detail` reads IssueStats over.
import {SwimlaneStats} from '../../../lib/stats/swimlane-stats.model.js';
import {getResultValue} from './gui-state-helper';

export type SwimlaneStatsState = {
	swimlaneId: string;
	loading: boolean;
	error: string | null;
	stats: SwimlaneStats | null;
};

export const useSwimlaneStats = ({
	swimlaneId,
	sendRaw,
}: {
	swimlaneId: string | null;
	sendRaw: (message: unknown) => void;
}) => {
	const [stats, setStats] = useState<SwimlaneStatsState | null>(null);

	// Asked for on opening the lane and not again: the traffic figures move
	// only when a ticket moves, and the reader is looking at a panel, not a
	// live gauge. Closing and opening it again is the refresh.
	useEffect(() => {
		if (!swimlaneId) {
			setStats(null);
			return;
		}

		setStats({swimlaneId, loading: true, error: null, stats: null});
		sendRaw({type: 'swimlane:stats:get', payload: {swimlaneId}});
	}, [swimlaneId, sendRaw]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'swimlane:stats:result') return;

		// Wrapped with the lane it was asked for: the panel stays open across a
		// change of lane, and a failed Result carries no id to tell whose reply
		// this is.
		const {swimlaneId: forLane, result} = message.payload as {
			swimlaneId: string;
			result: {status: string; message: string; value?: SwimlaneStats};
		};

		if (result?.status === 'fail') {
			setStats(prev =>
				prev && prev.swimlaneId === forLane
					? {...prev, loading: false, error: result.message}
					: prev,
			);
			return;
		}

		const next = getResultValue<SwimlaneStats>(result);

		if (next) {
			setStats(prev =>
				prev && prev.swimlaneId === forLane
					? {...prev, loading: false, error: null, stats: next}
					: prev,
			);
		}
	}, []);

	return {stats, onMessage};
};
