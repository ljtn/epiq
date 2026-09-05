import {isFail, succeeded} from '../../model/result-types.js';
import {getPersistRoot} from '../../storage/paths.js';

export const getPersistRootValue = async () => {
	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	return succeeded('Resolved persist root', persistRootResult.value);
};
