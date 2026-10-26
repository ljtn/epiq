// The viewer's own totals, for the identity panel. Refetched when a claim
// lands, since commits count over claimed addresses.

import {useCallback, useEffect, useState} from 'react';
import {PersonalStats} from '../../../lib/stats/personal-stats.model.js';
import {getResultValue} from './gui-state-helper';

export type PersonalStatsState = {
	loading: boolean;
	data: PersonalStats | null;
	error: string | null;
};

export const usePersonalStats = ({
	open,
	changed,
	sendRaw,
}: {
	open: boolean;
	/** Bumped by a claim or unclaim, which is what re-counts the commits. */
	changed: number;
	sendRaw: (message: unknown) => void;
}) => {
	const [state, setState] = useState<PersonalStatsState>({
		loading: false,
		data: null,
		error: null,
	});

	useEffect(() => {
		if (!open) return;

		setState(prev => ({...prev, loading: true, error: null}));
		sendRaw({type: 'me:stats:get'});
	}, [open, changed, sendRaw]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'me:stats') return;

		const value = getResultValue<PersonalStats>(message.payload);

		setState({
			loading: false,
			data: value ?? null,
			error: value ? null : message.payload?.message ?? 'Could not count',
		});
	}, []);

	return {...state, onMessage};
};
