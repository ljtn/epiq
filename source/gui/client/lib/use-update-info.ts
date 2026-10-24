// Whether a newer epiq is out, asked of the server once a socket is up. The
// server holds its answer for a day, so asking again costs nothing.

import {useCallback, useEffect, useRef, useState} from 'react';
import type {UpdateInfo} from '../../../lib/version/version.model.js';
import {pendingUpdate} from './update-info';

// A tab left open for days still hears about a release.
const REFRESH_AFTER_MS = 1000 * 60 * 60 * 6;

export const useUpdateInfo = ({
	socketEpoch,
	sendRaw,
}: {
	socketEpoch: number;
	sendRaw: (message: unknown) => void;
}) => {
	const [info, setInfo] = useState<UpdateInfo | null>(null);
	const askedAt = useRef(0);

	const ask = useCallback(() => {
		askedAt.current = Date.now();
		sendRaw({type: 'version:get'});
	}, [sendRaw]);

	useEffect(() => {
		if (socketEpoch === 0) return;

		ask();
	}, [socketEpoch, ask]);

	useEffect(() => {
		const refresh = () => {
			if (document.visibilityState === 'hidden') return;
			if (Date.now() - askedAt.current < REFRESH_AFTER_MS) return;

			ask();
		};

		window.addEventListener('focus', refresh);

		return () => window.removeEventListener('focus', refresh);
	}, [ask]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'version') return;

		setInfo(message.payload ?? null);
	}, []);

	return {update: pendingUpdate(info), onMessage};
};
