// Every lane's stay curve, for the sparkline each swimlane header draws.
//
// Asked for once per board rather than ridden along on the board broadcast: the
// curve is a month of daily readings and moves by a hair between one ticket and
// the next, which is not worth recomputing on every scrub tick.

import {useCallback, useEffect, useState} from 'react';
import {LaneStayPoint} from '../../../lib/stats/swimlane-stats.model.js';
import {getResultValue} from './gui-state-helper';

export type BoardStayTrends = Record<string, LaneStayPoint[]>;

export const useBoardStayTrends = ({
	boardId,
	socketEpoch,
	sendRaw,
}: {
	boardId: string | null;
	// Bumped on a reconnect, which is the other moment the answer has to be
	// asked for again — the old one was for a socket that is gone.
	socketEpoch: number;
	sendRaw: (message: unknown) => void;
}) => {
	const [trends, setTrends] = useState<BoardStayTrends>({});

	useEffect(() => {
		if (!boardId) return;

		sendRaw({type: 'board:stay-trends:get'});
	}, [boardId, socketEpoch, sendRaw]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'board:stay-trends:result') return;

		const next = getResultValue<BoardStayTrends>(message.payload);
		if (next) setTrends(next);
	}, []);

	return {trends, onMessage};
};
