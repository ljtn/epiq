import {ulid} from 'ulid';
import {ACTOR_NAME_ENV} from '../../config/actor-env.js';
import {readEpiqConfig, setConfig} from '../../config/user-config.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {patchSettingsState} from '../../state/settings.state.js';
import {patchState} from '../../state/state.js';
import {ConfigModifiers} from '../command-modifiers.js';
import {setAutoSyncDurationCommand} from '../commands/set-auto-sync-duration.cmd.js';
import {setAttachmentMaxKbCommand} from '../commands/set-attachment-max-kb.cmd.js';
import {setAutoSyncCommand} from '../commands/set-auto-sync.cmd.js';
import {setLogLevelCommand} from '../commands/set-log-level.cmd.js';
import {CommandLineInput} from '../../model/action-map.model.js';

export const configCommand = (cmdState: CommandLineInput) => {
	const value = cmdState.inputString.trim();

	switch (cmdState.modifier) {
		case ConfigModifiers.USERNAME: {
			// `EPIQ_USER_NAME` names this process, not the machine. Settings
			// state holds that actor, so writing it back here would overwrite
			// the configured user with whichever agent happens to be running.
			if (process.env[ACTOR_NAME_ENV]) {
				return failed(
					`Cannot change the configured user while ${ACTOR_NAME_ENV} names this process`,
				);
			}

			const configResult = readEpiqConfig();
			if (isFail(configResult)) return configResult;

			const {userId, preferredEditor, userName} = configResult.value;

			const resolvedUserName = value || userName;
			const resolvedUserId = userId || ulid();

			if (!resolvedUserName || !resolvedUserId) {
				return failed('Unable to resolve user name or id');
			}

			const persistResult = setConfig({
				userName: resolvedUserName,
				userId: resolvedUserId,
				preferredEditor: preferredEditor ?? '',
			});
			if (isFail(persistResult)) return persistResult;

			patchSettingsState({
				userName: resolvedUserName,
				userId: resolvedUserId,
			});

			patchState({mode: Mode.DEFAULT});

			return succeeded(`Username set to "${resolvedUserName}"`, null);
		}

		case ConfigModifiers.EDITOR: {
			if (!value) return failed('No editor provided');

			const persistResult = setConfig({preferredEditor: value});
			if (isFail(persistResult)) return persistResult;

			patchSettingsState({preferredEditor: value});
			patchState({mode: Mode.DEFAULT});

			return succeeded(`Editor configuration set to "${value}"`, null);
		}

		case ConfigModifiers.VIEW: {
			if (value !== 'wide' && value !== 'dense') {
				return failed('Invalid view mode');
			}

			const persistResult = setConfig({viewMode: value});
			if (isFail(persistResult)) return persistResult;

			patchSettingsState({viewMode: value});
			patchState({mode: Mode.DEFAULT});

			return succeeded(`View set to "${value}"`, null);
		}

		case ConfigModifiers.AUTOSYNC:
			return setAutoSyncCommand();

		case ConfigModifiers.LOG_LEVEL:
			return setLogLevelCommand();

		case ConfigModifiers.SYNC_DEBOUNCE_MS:
			return setAutoSyncDurationCommand();

		case ConfigModifiers.ATTACHMENT_MAX_KB:
			return setAttachmentMaxKbCommand();

		default:
			return failed('Unknown config command');
	}
};
