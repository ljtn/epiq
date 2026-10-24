// A newer epiq as the header draws it. Pure, so tests read it without a DOM.

import type {UpdateInfo} from '../../../lib/version/version.model.js';

/** The update worth drawing, or null: none is out, or the answer is malformed. */
export const pendingUpdate = (
	info: UpdateInfo | null,
): (UpdateInfo & {latest: string}) | null =>
	info?.updateAvailable && typeof info.latest === 'string'
		? {...info, latest: info.latest, releases: info.releases ?? []}
		: null;
