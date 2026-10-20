// What the board's panel needs that the board's own state does not carry: who
// works it, how fast tickets leave it, read off the whole log. One fetch, one
// reply, thrown away when the board changes.

import {useCallback, useEffect, useState} from 'react';
// Types only, from a module that declares nothing but types.
import {BoardOverview} from '../../../lib/stats/board-overview.model.js';
import {getResultValue} from './gui-state-helper';

export type BoardOverviewState = {
	boardId: string;
	loading: boolean;
	error: string | null;
	overview: BoardOverview | null;
};

export const useBoardOverview = ({
	boardId,
	sendRaw,
}: {
	// Null while the panel is closed or the board is replayed.
	boardId: string | null;
	sendRaw: (message: unknown) => void;
}) => {
	const [overview, setOverview] = useState<BoardOverviewState | null>(null);

	// Asked for on opening the panel, as a lane's figures are: closing and
	// opening it again is the refresh.
	useEffect(() => {
		if (!boardId) {
			setOverview(null);
			return;
		}

		setOverview({boardId, loading: true, error: null, overview: null});
		sendRaw({type: 'board:overview:get', payload: {boardId}});
	}, [boardId, sendRaw]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'board:overview:result') return;

		// Wrapped with the board it was asked for: a failed Result carries no id
		// to tell whose reply this is.
		const {boardId: forBoard, result} = message.payload as {
			boardId: string;
			result: {status: string; message: string; value?: BoardOverview};
		};

		if (result?.status === 'fail') {
			setOverview(prev =>
				prev && prev.boardId === forBoard
					? {...prev, loading: false, error: result.message}
					: prev,
			);
			return;
		}

		const next = getResultValue<BoardOverview>(result);

		if (next) {
			setOverview(prev =>
				prev && prev.boardId === forBoard
					? {...prev, loading: false, error: null, overview: next}
					: prev,
			);
		}
	}, []);

	return {overview, onMessage};
};
