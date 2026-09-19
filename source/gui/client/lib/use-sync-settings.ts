// This machine's auto sync preference, as the identity panel reads and writes
// it. A preference rather than board state: it is in `~/.epiq/config.json` and
// reaches no other clone, so nothing here goes through the mutation gate and
// no broadcast carries it.

import {useCallback, useEffect, useRef, useState} from 'react';
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
	});

	// Whether a change of ours is unanswered. `failed` is a broadcast for any
	// refusal on any socket, so without this the panel would report somebody
	// else's error as its own.
	const pending = useRef(false);

	// Asked for when the panel opens, and not polled: nothing changes this but
	// somebody changing it, and every reply to a change carries the new value.
	useEffect(() => {
		if (!open) return;

		setState(prev => ({...prev, loading: true, lastError: null}));
		sendRaw({type: 'settings:get'});
	}, [open, sendRaw]);

	const onMessage = useCallback((message: any) => {
		if (message.type === 'failed') {
			if (!pending.current) return;

			pending.current = false;
			setState(prev => ({
				...prev,
				loading: false,
				lastError: String(message.payload),
			}));
			return;
		}

		if (message.type !== 'settings') return;

		pending.current = false;

		const value = getResultValue<SyncSettings>(message.payload);

		if (!value) {
			setState(prev => ({
				...prev,
				loading: false,
				lastError: message.payload?.message ?? 'Could not read your settings',
			}));
			return;
		}

		setState({
			loading: false,
			data: value,
			lastError:
				message.lastAction && !message.lastAction.ok
					? String(message.lastAction.message)
					: null,
		});
	}, []);

	const change = useCallback(
		(patch: {autoSync?: boolean; autoSyncIntervalMs?: number}) => {
			pending.current = true;
			setState(prev => ({...prev, loading: true, lastError: null}));
			sendRaw({type: 'settings:set', payload: patch});
		},
		[sendRaw],
	);

	return {...state, onMessage, change};
};
