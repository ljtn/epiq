import {isFail, succeeded} from '../../model/result-types.js';
import {getPersistRoot} from '../../storage/paths.js';
import {getState} from '../../state/state.js';

export const getPersistRootValue = async () => {
	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	return succeeded('Resolved persist root', persistRootResult.value);
};

// The registry only holds people explicitly created or assigned, so it is often
// empty even of you; log authors are candidates too.
export const getAssignableContributors = (): {
	id: string;
	name: string;
	isExternal: boolean;
}[] => {
	// May run before boot has populated the log.
	const {eventLog = [], contributors} = getState();
	const byId = new Map<string, string>();
	const authorIds = new Set<string>();

	for (const event of eventLog) {
		if (!event.userId) continue;

		byId.set(event.userId, event.userName ?? '');
		authorIds.add(event.userId);
	}

	// The registry always wins; the log's sanitized copy is a fallback for an
	// author it has never seen.
	for (const contributor of Object.values(contributors)) {
		byId.set(contributor.id, contributor.name);
	}

	return [...byId.entries()].map(([id, name]) => ({
		id,
		name,
		isExternal: !authorIds.has(id),
	}));
};
