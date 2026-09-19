// How long a read-through scan of the repository may be reused. The scans are
// over git's own history — the commit timeline, the addresses its commits were
// signed with — and nothing invalidates them when a commit lands, so each one
// holds its answer for a few seconds and no longer.
//
// `EPIQ_CACHE_MS` overrides that, and zero turns it off: a server whose
// repository is being committed to between one request and the next hands back
// what is there now rather than what was there a moment ago. The browser suite
// is exactly that server — it commits mid-test — and waiting these caches out
// was two and a half minutes of it sleeping.

const OVERRIDE_ENV = 'EPIQ_CACHE_MS';

export const scanCacheMs = (defaultMs: number): number => {
	const raw = process.env[OVERRIDE_ENV];
	if (raw === undefined || raw.trim() === '') return defaultMs;

	const override = Number(raw);

	// A typo is not an instruction to cache forever, nor to stop caching: an
	// unreadable value leaves the default in place.
	return Number.isFinite(override) && override >= 0 ? override : defaultMs;
};
