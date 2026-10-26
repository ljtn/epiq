// How long a read-through scan of git history may be reused; nothing
// invalidates it on commit. `EPIQ_CACHE_MS` overrides, and 0 disables.

const OVERRIDE_ENV = 'EPIQ_CACHE_MS';

export const scanCacheMs = (defaultMs: number): number => {
	const raw = process.env[OVERRIDE_ENV];
	if (raw === undefined || raw.trim() === '') return defaultMs;

	const override = Number(raw);

	// A typo is not an instruction to cache forever, nor to stop caching: an
	// unreadable value leaves the default in place.
	return Number.isFinite(override) && override >= 0 ? override : defaultMs;
};
