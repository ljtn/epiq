import z from 'zod';
import {setConfig} from '../../config/user-config.js';
import {DEFAULT_ATTACHMENT_MAX_KB} from '../../media/media-store.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {patchSettingsState} from '../../state/settings.state.js';
import {patchState} from '../../state/state.js';

export const MIN_ATTACHMENT_MAX_KB = 50;
export const MAX_ATTACHMENT_MAX_KB = 5_000;

export const setAttachmentMaxKbCommand = () => {
	const selectionVal = getCmdState().commandMeta.inputString;

	const maxKb = z.coerce
		.number()
		.int()
		.min(MIN_ATTACHMENT_MAX_KB)
		.max(MAX_ATTACHMENT_MAX_KB)
		.safeParse(selectionVal);

	if (!maxKb.success) {
		return failed(
			`Attachment size cap must be ${MIN_ATTACHMENT_MAX_KB}-${MAX_ATTACHMENT_MAX_KB} KB (default ${DEFAULT_ATTACHMENT_MAX_KB})`,
		);
	}

	const persistResult = setConfig({attachmentMaxKb: maxKb.data});
	if (isFail(persistResult)) return persistResult;

	patchSettingsState({attachmentMaxKb: maxKb.data});
	patchState({mode: Mode.DEFAULT});

	return succeeded(`Attachment size cap set to ${maxKb.data} KB`, null);
};
