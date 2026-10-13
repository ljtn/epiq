import z from 'zod';
import {
	DEFAULT_REPO_CLONE_MAX_MB,
	MAX_REPO_CLONE_MAX_MB,
	MIN_REPO_CLONE_MAX_MB,
} from '../../commits/clone-size.js';
import {setConfig} from '../../config/user-config.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';

export const setRepoCloneMaxMbCommand = () => {
	const maxMb = z.coerce
		.number()
		.int()
		.min(MIN_REPO_CLONE_MAX_MB)
		.max(MAX_REPO_CLONE_MAX_MB)
		.safeParse(getCmdState().commandMeta.inputString);

	if (!maxMb.success) {
		return failed(
			`A linked repo's clone cap must be ${MIN_REPO_CLONE_MAX_MB}-${MAX_REPO_CLONE_MAX_MB} MB (default ${DEFAULT_REPO_CLONE_MAX_MB})`,
		);
	}

	// Read on every fetch, so nothing else needs telling.
	const persistResult = setConfig({repoCloneMaxMb: maxMb.data});
	if (isFail(persistResult)) return persistResult;

	return succeeded(`Linked repo clone cap set to ${maxMb.data} MB`, null);
};
