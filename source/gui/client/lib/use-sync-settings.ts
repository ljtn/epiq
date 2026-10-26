// This machine's auto sync preference, from `~/.epiq/config.json`: not board
// state, so no mutation gate or broadcast.

import {useCallback, useEffect, useState} from 'react';
import {getResultValue} from './gui-state-helper';

export type SyncSettings = {
	enabled: boolean;
	intervalMs: number;
	/** Why an enabled auto sync still would not run, or null where it would. */
	blockedReason: string | null;
};

export type SyncSettingsState = {
	loading: boolean;
	data: SyncSettings | null;
	/** Why the last change was refused; a change that landed shows in the controls. */
	lastError: string | null;
	/** Bumped on every server answer, so a refused write is heard too. */
	answeredAt: number;
};

export const useSyncSettings = ({
	open,
	sendRaw,
}: {
	open: boolean;
	sendRaw: (message: unknown) => void;
}) => {
	const [state, setState] = useState<SyncSettingsState>({
		loading: false,
		data: null,
		lastError: null,
		answeredAt: 0,
	});

	// Asked for when the panel opens, and not polled: nothing changes this but
	// somebody changing it, and every reply to a change carries the new value.
	useEffect(() => {
		if (!open) return;

		setState(prev => ({...prev, loading: true, lastError: null}));
		sendRaw({type: 'settings:get'});
	}, [open, sendRaw]);

	// Ignores `failed`: that is the read-only gate refusing a board mutation,
	// never this preference.
	const onMessage = useCallback((message: any) => {
		if (message.type !== 'settings') return;

		const value = getResultValue<SyncSettings>(message.payload);

		if (!value) {
			setState(prev => ({
				...prev,
				loading: false,
				lastError: message.payload?.message ?? 'Could not read your settings',
				answeredAt: prev.answeredAt + 1,
			}));
			return;
		}

		setState(prev => ({
			loading: false,
			data: value,
			lastError:
				message.lastAction && !message.lastAction.ok
					? String(message.lastAction.message)
					: null,
			answeredAt: prev.answeredAt + 1,
		}));
	}, []);

	const change = useCallback(
		(patch: {autoSync?: boolean; autoSyncIntervalMs?: number}) => {
			setState(prev => ({...prev, loading: true, lastError: null}));
			sendRaw({type: 'settings:set', payload: patch});
		},
		[sendRaw],
	);

	return {...state, onMessage, change};
};
