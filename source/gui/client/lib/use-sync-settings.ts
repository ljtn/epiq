// This machine's auto sync preference, as the identity panel reads and writes
// it. A preference rather than board state: it is in `~/.epiq/config.json` and
// reaches no other clone, so nothing here goes through the mutation gate and
// no broadcast carries it.

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
	/**
	 * Why the last change was refused, when it was. Only a failure: a change
	 * that landed shows in the controls themselves.
	 */
	lastError: string | null;
	/**
	 * Bumped on every answer from the server, whether it changed anything or
	 * not.
	 *
	 * A refused write comes back with the settings unaltered, so a field
	 * watching only the value would never hear about it and would sit showing
	 * the number that was turned down. This is what says "the server has
	 * spoken" when what it said is "no".
	 */
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

	// Deliberately deaf to `failed`, unlike the hook beside it that reads the
	// addresses. That frame is the read-only gate refusing a *mutating*
	// message, and a preference on this machine is not one — so the only
	// `failed` that could arrive here belongs to somebody else's write, and
	// reporting it would put a board error under the auto sync toggle. A
	// refused settings write comes back as a `settings` reply carrying its own
	// `lastAction`.
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
