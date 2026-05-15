import React, {useEffect} from 'react';
import {queueAutoSync} from '../../git/auto-sync.js';
import {getSettingsState} from '../state/settings.state.js';
import {getState} from '../state/state.js';

export const useAutoSyncInterval = (autoSync: boolean | null) => {
	useEffect(() => {
		if (!autoSync) return;

		let timer: NodeJS.Timeout | undefined;
		let disposed = false;

		const schedule = () => {
			if (disposed) return;

			const {autoSyncIntervalMs, userName, preferredEditor} =
				getSettingsState();

			// App not fully configured yet
			if (!preferredEditor) return;
			if (!userName) return;
			if (!autoSyncIntervalMs) return;

			timer = setTimeout(() => {
				if (disposed) return;

				const {readOnly, mode} = getState();

				if (mode === 'default' && !readOnly) {
					queueAutoSync();
				}

				schedule();
			}, autoSyncIntervalMs);
		};

		schedule();

		return () => {
			disposed = true;

			if (timer) {
				clearTimeout(timer);
			}
		};
	}, [autoSync]);
};

export const AutoSyncController: React.FC<{
	autoSync: boolean | null;
}> = ({autoSync}) => {
	useAutoSyncInterval(autoSync);

	return null;
};
